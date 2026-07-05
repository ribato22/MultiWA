// MultiWA Gateway API - Engine Manager Service
// apps/api/src/modules/profiles/engine-manager.service.ts
//
// This service manages WhatsApp engine instances and emits realtime events
// through the injected RealtimeEmitter (EventsGateway in the API; a Redis
// publisher in the worker), decoupling it from Socket.IO so it can run in either
// process. See architecture/engine-worker-migration-sop.md.

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { REALTIME_EMITTER, RealtimeEmitter } from '@multiwa/core';
import { prisma } from '@multiwa/database';
import { evaluateColdCircuit } from '@multiwa/engine-runtime';
import { EngineFactory } from '@multiwa/engines';
import type { IWhatsAppEngine, EngineConfig, EngineType } from '@multiwa/engines';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '@multiwa/core';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { WorkerRuleEngineService, IncomingMessage } from './rule-engine.service';
import { WorkerNotificationsService, NotificationType } from './notifications.service';
// NOTE (worker-local copy): only in-app notification rows are written here; the
// email/push fan-out is best-effort and retained on the API path.


interface EngineInstance {
  engine: IWhatsAppEngine;
  profileId: string;
  status: 'connecting' | 'connected' | 'disconnected';
}

@Injectable()
export class EngineManagerService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(EngineManagerService.name);
  private engines = new Map<string, EngineInstance>();
  // Cache resolved WhatsApp group subjects (jid -> {name, at}) so we don't do a
  // getChatById round-trip on every inbound group message.
  private groupNameCache = new Map<string, { name: string; at: number }>();
  // Profiles whose one-off @lid reconciliation already ran this process.
  private reconciledLid = new Set<string>();
  // Profiles whose one-off group-name reconciliation already ran this process.
  private reconciledGroups = new Set<string>();

  constructor(
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => WorkerRuleEngineService))
    private readonly ruleEngine: WorkerRuleEngineService,
    private readonly notificationsService: WorkerNotificationsService,
  ) {
    this.logger.log('Worker EngineManagerService initialized');
  }

  /**
   * Resolve a WhatsApp group's subject (name) via the engine, cached for 1h.
   * Falls back to `fallback` if the lookup fails/returns empty — never throws.
   */
  private async resolveGroupName(profileId: string, jid: string, fallback: string): Promise<string> {
    const cached = this.groupNameCache.get(jid);
    if (cached && Date.now() - cached.at < 3_600_000) return cached.name || fallback;
    try {
      const engine = this.engines.get(profileId)?.engine;
      if (engine) {
        const info = await engine.getGroupInfo(jid);
        const name = (info?.name || '').trim();
        if (name) {
          this.groupNameCache.set(jid, { name, at: Date.now() });
          return name;
        }
      }
    } catch (err) {
      this.logger.warn(`Group name resolve failed for ${jid}: ${(err as Error).message}`);
    }
    return fallback;
  }

  /**
   * One-off reconciliation of legacy @lid conversations: resolve each to the real
   * phone JID via the live engine, then MERGE into an existing phone conversation
   * (re-point messages, delete the @lid row) or CONVERT the row's jid+name in place.
   * Env-gated: RECONCILE_LID='dry' logs the plan only, 'run' executes. Idempotent —
   * once converted there are no @lid rows left, so re-runs are no-ops.
   */
  private async reconcileLid(profileId: string, dryRun: boolean): Promise<void> {
    if (this.reconciledLid.has(profileId)) return;
    this.reconciledLid.add(profileId);
    const engine = this.engines.get(profileId)?.engine;
    if (!engine?.resolveIdentity) { this.logger.warn('[reconcile-lid] engine has no resolveIdentity'); return; }
    const lidConvs = await prisma.conversation.findMany({ where: { profileId, jid: { endsWith: '@lid' } } });
    this.logger.warn(`[reconcile-lid] ${dryRun ? 'DRY-RUN' : 'EXECUTE'} for ${profileId}: ${lidConvs.length} @lid conversation(s)`);
    for (const conv of lidConvs) {
      try {
        const ident = await engine.resolveIdentity(conv.jid);
        if (!ident?.phoneJid) { this.logger.warn(`[reconcile-lid] ${conv.jid}: UNRESOLVED (leaving as-is)`); continue; }
        const phoneJid = ident.phoneJid;
        const name = ident.name || conv.name;
        const sibling = await prisma.conversation.findFirst({ where: { profileId, jid: phoneJid } });
        if (sibling && sibling.id !== conv.id) {
          const msgs = await prisma.message.count({ where: { conversationId: conv.id } });
          this.logger.warn(`[reconcile-lid] MERGE ${conv.jid} -> ${phoneJid} (into ${sibling.id}, re-point ${msgs} msg, delete @lid row)`);
          if (!dryRun) {
            await prisma.message.updateMany({ where: { conversationId: conv.id }, data: { conversationId: sibling.id } });
            await prisma.conversation.update({ where: { id: sibling.id }, data: { unreadCount: { increment: conv.unreadCount || 0 } } });
            await prisma.conversation.delete({ where: { id: conv.id } });
          }
        } else {
          this.logger.warn(`[reconcile-lid] CONVERT ${conv.jid} -> ${phoneJid}, name="${name}"`);
          if (!dryRun) {
            await prisma.conversation.update({
              where: { id: conv.id },
              data: { jid: phoneJid, name, metadata: { ...((conv.metadata as any) || {}), lidJid: conv.jid } },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`[reconcile-lid] ${conv.jid}: ERROR ${(err as Error).message}`);
      }
    }
    this.logger.warn('[reconcile-lid] done');
  }

  /**
   * One-off reconciliation of group conversation names: set conversation.name to
   * the live WhatsApp group subject (engine.getGroupInfo) for every @g.us row,
   * fixing rows previously created with a sender's pushName. Env-gated by
   * RECONCILE_LID ('dry' logs, 'run' writes). Idempotent.
   */
  private async reconcileGroupNames(profileId: string, dryRun: boolean): Promise<void> {
    if (this.reconciledGroups.has(profileId)) return;
    this.reconciledGroups.add(profileId);
    const engine = this.engines.get(profileId)?.engine;
    if (!engine?.getGroupInfo) return;
    const groups = await prisma.conversation.findMany({
      where: { profileId, OR: [{ type: 'group' }, { jid: { endsWith: '@g.us' } }] },
    });
    this.logger.warn(`[reconcile-groups] ${dryRun ? 'DRY-RUN' : 'EXECUTE'} for ${profileId}: ${groups.length} group(s)`);
    for (const g of groups) {
      try {
        const info = await engine.getGroupInfo(g.jid);
        const subject = (info?.name || '').trim();
        if (subject && subject !== g.name) {
          this.logger.warn(`[reconcile-groups] ${g.jid}: "${g.name}" -> "${subject}"`);
          if (!dryRun) await prisma.conversation.update({ where: { id: g.id }, data: { name: subject } });
        } else {
          this.logger.warn(`[reconcile-groups] ${g.jid}: subject="${subject || '(empty)'}" (no change)`);
        }
      } catch (err) {
        this.logger.warn(`[reconcile-groups] ${g.jid}: ERROR ${(err as Error).message}`);
      }
    }
    this.logger.warn('[reconcile-groups] done');
  }

  /**
   * Create in-app notifications for all users in the profile's organization.
   */
  private async notifyOrgUsers(
    profileId: string,
    type: NotificationType,
    title: string,
    body: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { workspace: { select: { organizationId: true } } },
    });
    const orgId = profile?.workspace?.organizationId;
    if (!orgId) return;
    await this.notificationsService.createForOrg(orgId, type, title, body, metadata);
  }

  /**
   * Publish an application-bus event (dot-namespaced). Fire-and-forget: never let
   * a listener error disrupt the WhatsApp engine callback that produced it. The
   * WebhookDispatcher and plugin loader consume these.
   */
  private emitEvent(event: string, payload: Record<string, unknown>): void {
    try {
      this.eventEmitter.emit(event, payload);
    } catch (err) {
      this.logger.warn(`Failed to emit '${event}': ${(err as Error).message}`);
    }
  }

  /**
   * On module init:
   * 1. Reset stale 'connected' profiles to 'disconnected'
   * 2. Auto-reconnect profiles that have valid session data
   */
  async onModuleInit() {
    // The worker owns engine sessions only when ENGINE_HOST=worker. (The Nest
    // context that instantiates this is only created in that mode, but guard
    // defensively.)
    if (process.env.ENGINE_HOST !== 'worker') {
      return;
    }

    this.logger.log('Worker EngineManagerService initializing...');

    const envEngine = process.env.DEFAULT_ENGINE;
    if (envEngine && !['whatsapp-web-js', 'baileys', 'mock'].includes(envEngine)) {
      this.logger.warn(`DEFAULT_ENGINE='${envEngine}' is not a valid engine; profiles without an explicit engine will use whatsapp-web-js`);
    }

    try {
      // Step 1: Reset all profiles that show as 'connected' in the database
      // (since we just started, no engines are actually running)
      const staleProfiles = await prisma.profile.findMany({
        where: { status: 'connected' },
        select: { id: true, displayName: true },
      });

      if (staleProfiles.length > 0) {
        this.logger.warn(`Found ${staleProfiles.length} stale 'connected' profiles, resetting to 'disconnected'`);
        
        await prisma.profile.updateMany({
          where: { status: 'connected' },
          data: { status: 'disconnected' },
        });

        for (const profile of staleProfiles) {
          this.logger.log(`Reset profile to disconnected: ${profile.displayName || profile.id}`);
        }
      }

      // Step 2: Auto-reconnect profiles that have valid session data
      await this.autoReconnectProfiles();
      
    } catch (error) {
      this.logger.error('Error in onModuleInit:', error);
    }
  }

  /**
   * Auto-reconnect profiles that have existing session credentials
   * This allows profiles to resume connection after API restart without QR scan
   */
  private async autoReconnectProfiles() {
    this.logger.log('Checking for profiles with valid sessions to auto-reconnect...');
    
    const fs = await import('fs/promises');
    const sessionsDir = process.env.SESSIONS_DIR || '/data/sessions';
    
    try {
      // Get all profiles
      const profiles = await prisma.profile.findMany({
        select: { id: true, displayName: true, lastConnectedAt: true },
      });

      let reconnectedCount = 0;
      
      for (const profile of profiles) {
        const sessionDir = path.join(sessionsDir, profile.id);
        // whatsapp-web.js LocalAuth (dataPath=sessionDir) stores data in
        // {dataPath}/session-{clientId}/ — NOT under a .wwebjs_auth subdir.
        const wwebjsSessionDir = path.join(sessionDir, `session-${profile.id}`);
        // Also check for Baileys-style creds.json as fallback
        const credsPath = path.join(sessionDir, 'creds.json');
        
        let hasSession = false;
        try {
          await fs.access(wwebjsSessionDir);
          hasSession = true;
          this.logger.log(`Found whatsapp-web.js session for: ${profile.displayName || profile.id}`);
        } catch {
          try {
            await fs.access(credsPath);
            hasSession = true;
            this.logger.log(`Found Baileys session for: ${profile.displayName || profile.id}`);
          } catch {
            // No session found
          }
        }

        if (!hasSession) {
          this.logger.debug(`No session found for profile: ${profile.displayName || profile.id}`);
          continue;
        }

        try {
          
          // Session exists, auto-reconnect
          this.logger.log(`Auto-reconnecting profile: ${profile.displayName || profile.id}`);
          
          // Connect in background (don't await to avoid blocking startup)
          this.connectProfile(profile.id)
            .then(result => {
              this.logger.log(`Auto-reconnect result for ${profile.displayName || profile.id}: ${result.message}`);
            })
            .catch(async (err) => {
              this.logger.error(`Auto-reconnect failed for ${profile.displayName || profile.id}:`, err);
              
              // Clear corrupted session data so user gets fresh QR on next connect
              try {
                const sessionDir2 = path.join(sessionsDir, profile.id);
                await fs.rm(sessionDir2, { recursive: true, force: true });
                this.logger.warn(`Cleared corrupted session for ${profile.displayName || profile.id} after auto-reconnect failure`);
              } catch (clearErr) {
                this.logger.warn(`Could not clear session: ${(clearErr as Error).message}`);
              }
              
              // Ensure DB status is reset
              try {
                await prisma.profile.update({
                  where: { id: profile.id },
                  data: { status: 'disconnected' },
                });
              } catch (dbErr) {
                this.logger.error(`Failed to reset profile status:`, dbErr);
              }
            });
          
          reconnectedCount++;
          
          // Small delay between reconnects to avoid overwhelming WhatsApp
          await new Promise(resolve => setTimeout(resolve, 2000));
          
        } catch (reconnectErr: any) {
          this.logger.error(`Failed to reconnect profile ${profile.displayName || profile.id}: ${reconnectErr.message}`);
        }
      }

      if (reconnectedCount > 0) {
        this.logger.log(`Initiated auto-reconnect for ${reconnectedCount} profile(s)`);
      } else {
        this.logger.log('No profiles with valid sessions found for auto-reconnect');
      }
      
    } catch (error: any) {
      this.logger.warn(`Could not check sessions directory: ${error.message}`);
    }
  }

  /**
   * Clean up stale Chromium lock files that persist after container restart.
   * These files prevent Puppeteer from launching a new browser.
   */
  private async cleanupStaleLockFiles(sessionDir: string): Promise<void> {
    const fs = await import('fs/promises');
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    
    // Recursively find and remove lock files in the session directory
    try {
      await fs.access(sessionDir);
    } catch {
      return; // Session dir doesn't exist yet, nothing to clean
    }
    
    // Walk through known Chromium profile subdirectories
    try {
      const entries = await fs.readdir(sessionDir, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (lockFiles.includes(entry.name)) {
          const lockPath = path.join(entry.parentPath || entry.path, entry.name);
          try {
            await fs.unlink(lockPath);
            this.logger.log(`Removed stale Chromium lock file: ${lockPath}`);
          } catch (e) {
            this.logger.warn(`Could not remove lock file ${lockPath}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Error scanning for lock files: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    // Cleanup all engines on shutdown
    for (const [profileId, instance] of this.engines) {
      try {
        await instance.engine.destroy?.();
        this.logger.log(`Engine destroyed for profile ${profileId}`);
      } catch (error) {
        this.logger.error(`Error destroying engine for ${profileId}:`, error);
      }
    }
    this.engines.clear();
  }

  /**
   * Resolve which engine to instantiate for a profile.
   * Precedence: validated profile.engine -> DEFAULT_ENGINE env -> whatsapp-web-js.
   * See architecture/multi-engine-sop.md. EngineFactory.create() is used (never
   * getOrCreate) — EngineManagerService.engines is the sole instance owner.
   */
  private resolveEngineType(engineField?: string | null): EngineType {
    const valid: EngineType[] = ['whatsapp-web-js', 'baileys', 'mock'];
    let selected: EngineType;

    if (engineField && valid.includes(engineField as EngineType)) {
      selected = engineField as EngineType;
    } else {
      const envDefault = process.env.DEFAULT_ENGINE;
      if (envDefault && valid.includes(envDefault as EngineType)) {
        if (engineField) {
          this.logger.warn(`Profile engine '${engineField}' invalid; falling back to DEFAULT_ENGINE='${envDefault}'`);
        }
        selected = envDefault as EngineType;
      } else {
        if (engineField) {
          this.logger.warn(`Profile engine '${engineField}' is not a known engine; defaulting to whatsapp-web-js`);
        }
        selected = 'whatsapp-web-js';
      }
    }

    if (selected === 'baileys') {
      this.logger.warn(
        'Profile is using the EXPERIMENTAL Baileys engine — sendReaction is a no-op stub and getContacts may be unavailable. Use whatsapp-web-js for production.',
      );
    }
    return selected;
  }

  /**
   * Initialize and connect a WhatsApp engine for a profile
   */
  async connectProfile(profileId: string): Promise<{ status: string; message: string }> {
    this.logger.log(`Connecting profile: ${profileId}`);

    // Check if already connected
    const existing = this.engines.get(profileId);
    if (existing && existing.status === 'connected') {
      return { status: 'already_connected', message: 'Profile already connected' };
    }

    // Destroy any existing engine instance (e.g. from a failed previous attempt)
    if (existing) {
      this.logger.log(`Destroying stale engine instance for ${profileId}`);
      try {
        await existing.engine.destroy?.();
      } catch (e) {
        this.logger.warn(`Error destroying stale engine: ${(e as Error).message}`);
      }
      this.engines.delete(profileId);
    }

    // Get profile from database
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Update status to connecting
    await prisma.profile.update({
      where: { id: profileId },
      data: { status: 'connecting' },
    });

    // Create engine config with callbacks
    const sessionsBase = process.env.SESSIONS_DIR || './sessions';
    const sessionDir = path.join(sessionsBase, profileId);

    // Clean up stale Chromium lock files from previous container runs
    // Without this, Puppeteer refuses to launch: "The profile appears to be in use by another Chromium process"
    await this.cleanupStaleLockFiles(sessionDir);
    
    const engineConfig: EngineConfig = {
      profileId,
      sessionDir,
      onQR: async (qr: string) => {
        this.logger.log(`QR code received for profile ${profileId}`);
        
        try {
          // Convert QR string to data URL for frontend <img> display
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 256,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          
          // Emit QR data URL to WebSocket clients
          this.realtime.emitQrUpdate(profileId, qrDataUrl);
          this.emitEvent(AppEvents.CONNECTION.QR, { profileId, qr: qrDataUrl });
          this.logger.log(`QR code emitted via WebSocket for profile ${profileId}`);
        } catch (error) {
          this.logger.error(`Error generating QR data URL:`, error);
          // Fallback: send raw QR string
          this.realtime.emitQrUpdate(profileId, qr);
        }
      },
      onReady: async (phone: string, pushName: string) => {
        this.logger.log(`Profile ${profileId} connected: ${phone} (${pushName})`);

        // Phone number guard: if user initially registered the profile with a
        // specific phone number, refuse to silently overwrite it with a
        // different WhatsApp account. The frontend listens for
        // 'connection:status' status='error' and shows the toast.
        const existing = await prisma.profile.findUnique({
          where: { id: profileId },
          select: { phoneNumber: true, displayName: true },
        });
        const expected = (existing?.phoneNumber || '').replace(/\D/g, '');
        const actual = (phone || '').replace(/\D/g, '');
        if (expected && expected !== actual) {
          this.logger.warn(
            `Profile ${profileId}: scanned WA number ${actual} does not match expected ${expected}. Disconnecting.`,
          );
          this.realtime.emitConnectionStatus(
            profileId,
            'error',
            `Scanned number does not match this profile. Expected ${expected}, got ${actual}.`,
          );
          // Disconnect the just-linked engine; user can rescan with the correct device.
          try {
            const instance2 = this.engines.get(profileId);
            await instance2?.engine.disconnect();
          } catch (err) {
            this.logger.warn(`Failed to disconnect mismatched engine: ${(err as Error).message}`);
          }
          this.engines.delete(profileId);
          await prisma.profile.update({
            where: { id: profileId },
            data: { status: 'disconnected' },
          });
          return;
        }

        // Update engine instance status
        const instance = this.engines.get(profileId);
        if (instance) {
          instance.status = 'connected';
        }

        // Update database
        await prisma.profile.update({
          where: { id: profileId },
          data: {
            status: 'connected',
            phoneNumber: phone,
            lastConnectedAt: new Date(),
          },
        });

        // Emit connection status via WebSocket
        this.realtime.emitConnectionStatus(profileId, 'connected', phone);
        this.emitEvent(AppEvents.CONNECTION.READY, { profileId, phone, pushName });

        // One-off legacy @lid reconciliation (env-gated, runs once the engine is ready).
        if (process.env.RECONCILE_LID) {
          this.reconcileLid(profileId, process.env.RECONCILE_LID !== 'run')
            .catch((e) => this.logger.warn(`reconcile-lid failed: ${(e as Error).message}`));
          this.reconcileGroupNames(profileId, process.env.RECONCILE_LID !== 'run')
            .catch((e) => this.logger.warn(`reconcile-groups failed: ${(e as Error).message}`));
        }

        this.notifyOrgUsers(profileId, NotificationType.CONNECTION, '✅ Profile Connected',
          `${profile.displayName || phone} is now connected`, { profileId, phone },
        ).catch(err => this.logger.warn(`Notification error (connection): ${err.message}`));
      },
      onDisconnected: async (reason: string) => {
        this.logger.log(`Profile ${profileId} disconnected: ${reason}`);
        
        // Update engine instance status
        const instance = this.engines.get(profileId);
        if (instance) {
          instance.status = 'disconnected';
        }

        // Only clear session folder for actual session invalidation (logged out, expired)
        // Do NOT clear for temporary errors like 'Stream Errored' or 'Connection Failure'
        // as these may recover on reconnect
        const sessionInvalidReasons = ['Session Expired', 'Logged Out', 'loggedOut'];
        const isSessionInvalid = sessionInvalidReasons.some(r => reason.includes(r));
        
        if (isSessionInvalid) {
          this.logger.warn(`Session invalidated for ${profileId}, clearing session folder for fresh QR`);
          try {
            const fs = await import('fs/promises');
            await fs.rm(sessionDir, { recursive: true, force: true });
            this.logger.log(`Session folder cleared for ${profileId}`);
          } catch (err) {
            this.logger.error(`Failed to clear session folder:`, err);
          }
          
          // Update database
          await prisma.profile.update({
            where: { id: profileId },
            data: { status: 'disconnected' },
          });
          this.realtime.emitConnectionStatus(profileId, 'disconnected');
          this.emitEvent(AppEvents.CONNECTION.DISCONNECTED, { profileId, reason });
          this.notifyOrgUsers(profileId, NotificationType.DISCONNECTION, '⚠️ Profile Disconnected',
            `${profile.displayName || profileId} was disconnected: ${reason}`, { profileId, reason },
          ).catch(err => this.logger.warn(`Notification error (disconnection): ${err.message}`));
        } else {

          // Temporary disconnect — attempt auto-retry with exponential backoff
          const maxRetries = 3;
          const baseDelay = 5000; // 5 seconds
          
          // Clean up the failed engine instance first
          try {
            await instance?.engine?.destroy?.();
          } catch (e) {
            this.logger.warn(`Error destroying engine before retry: ${(e as Error).message}`);
          }
          this.engines.delete(profileId);

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const delay = baseDelay * Math.pow(3, attempt - 1); // 5s, 15s, 45s
            this.logger.log(`Auto-retry ${attempt}/${maxRetries} for ${profileId} in ${delay / 1000}s (reason: ${reason})`);
            
            // Emit reconnecting status so frontend shows progress
            await prisma.profile.update({
              where: { id: profileId },
              data: { status: 'connecting' },
            });
            this.realtime.emitConnectionStatus(profileId, `reconnecting (${attempt}/${maxRetries})`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
              const result = await this.connectProfile(profileId);
              if (result.status === 'connecting' || result.status === 'already_connected') {
                this.logger.log(`Auto-retry successful for ${profileId} on attempt ${attempt}`);
                return; // Success, exit the retry loop
              }
            } catch (retryErr: any) {
              this.logger.warn(`Auto-retry attempt ${attempt}/${maxRetries} failed for ${profileId}: ${retryErr.message}`);
            }
          }
          
          // All retries exhausted
          this.logger.error(`All ${maxRetries} auto-retry attempts failed for ${profileId}`);
          await prisma.profile.update({
            where: { id: profileId },
            data: { status: 'disconnected' },
          });
          this.realtime.emitConnectionStatus(profileId, 'disconnected');
          this.emitEvent(AppEvents.CONNECTION.DISCONNECTED, { profileId, reason: 'max retries exhausted' });
        }
      },
      onMessage: async (message: any) => {
        // Skip bot's own messages to prevent reply loops
        if (message.fromMe) {
          this.logger.debug(`Skipping own message for profile ${profileId}`);
          return;
        }
        this.logger.log(`📨 Incoming message for profile ${profileId} from ${message.from}: type=${message.type}, body=${(message.body || '').substring(0, 50)}`);
        try {
          // Determine message type and content
          const msgType = message.type || 'chat';
          const isGroup = message.from?.includes('@g.us') || false;
          const rawSenderJid = message.author || message.from || '';
          // Normalize JID: whatsapp-web.js uses @c.us for individual chats,
          // but our API uses @s.whatsapp.net — normalize to prevent duplicate conversations
          let senderJid = isGroup ? rawSenderJid : rawSenderJid.replace('@c.us', '@s.whatsapp.net');
          let senderName = message._data?.notifyName || message.pushName || senderJid.split('@')[0];
          
          // Get or create conversation — use normalized JID
          const rawJid = message.from || '';
          let jid = isGroup ? rawJid : rawJid.replace('@c.us', '@s.whatsapp.net');

          // LID resolution: WhatsApp's hidden-number identity (@lid) is a separate
          // JID from the phone number for the same person -> it would create a
          // duplicate conversation/contact. For DMs, map @lid -> the real phone JID
          // (when WA can resolve it) so everything dedups onto one row.
          let lidJid: string | null = null;
          if (!isGroup && jid.includes('@lid')) {
            lidJid = jid;
            try {
              const lidEngine = this.engines.get(profileId)?.engine;
              const ident = lidEngine?.resolveIdentity ? await lidEngine.resolveIdentity(jid) : null;
              if (ident?.phoneJid) { jid = ident.phoneJid; senderJid = ident.phoneJid; }
              if (ident?.name) senderName = ident.name;
            } catch (err) {
              this.logger.warn(`LID resolve failed for ${jid}: ${(err as Error).message}`);
            }
          }
          let conversation = await prisma.conversation.findFirst({
            where: { profileId, jid },
          });
          // For groups, use the real WhatsApp group subject — not the sender's name.
          const groupName = isGroup ? await this.resolveGroupName(profileId, jid, senderName || jid) : null;
          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                profileId,
                jid,
                name: isGroup ? (groupName || jid) : (senderName || jid),
                type: isGroup ? 'group' : 'user',
                ...(lidJid ? { metadata: { lidJid, lidResolved: jid !== lidJid } } : {}),
              },
            });
          } else if (isGroup && groupName && conversation.name !== groupName) {
            // Backfill the authoritative group subject onto a row previously
            // created with a sender's pushName.
            await prisma.conversation.update({ where: { id: conversation.id }, data: { name: groupName } });
            conversation.name = groupName;
          }

          // Build content object
          const content: any = {};
          if (message.body) content.text = message.body;

          // Debug logging for special message types
          if (['location', 'poll', 'poll_creation', 'event', 'event_creation'].includes(msgType)) {
            this.logger.log(`🔍 Special msg type=${msgType}, keys=${Object.keys(message).join(',')}`);
            this.logger.log(`🔍 message.location=${JSON.stringify(message.location)}`);
            this.logger.log(`🔍 message.pollName=${message.pollName}, message.pollOptions=${JSON.stringify(message.pollOptions)}`);
            if (message._data) {
              this.logger.log(`🔍 message._data keys=${Object.keys(message._data).join(',')}`);
              this.logger.log(`🔍 message._data.lat=${message._data.lat}, message._data.lng=${message._data.lng}`);
              this.logger.log(`🔍 message._data.pollName=${message._data.pollName}`);
              this.logger.log(`🔍 message._data.pollOptions=${JSON.stringify(message._data.pollOptions)}`);
              this.logger.log(`🔍 message._data.eventName=${message._data.eventName}`);
              this.logger.log(`🔍 message._data.eventDescription=${message._data.eventDescription}`);
              this.logger.log(`🔍 message._data.eventStartTime=${message._data.eventStartTime}`);
              this.logger.log(`🔍 message._data relevant=${JSON.stringify({
                lat: message._data.lat,
                lng: message._data.lng,
                loc: message._data.loc,
                body: (message._data.body || '').substring(0, 100),
                type: message._data.type,
                subtype: message._data.subtype,
                pollName: message._data.pollName,
                pollOptions: message._data.pollOptions,
                pollInvalidated: message._data.pollInvalidated,
                eventName: message._data.eventName,
                eventDescription: message._data.eventDescription,
                eventStartTime: message._data.eventStartTime,
                eventEndTime: message._data.eventEndTime,
                eventLocation: message._data.eventLocation,
              })}`);
            }
          }

          if (message.hasMedia) {
            try {
              const media = await message.downloadMedia?.();
              if (media) {
                content.mimetype = media.mimetype;
                content.filename = media.filename;
                content.hasMedia = true;
                // Store base64 data as data URL for frontend rendering
                if (media.data) {
                  content.url = `data:${media.mimetype};base64,${media.data}`;
                }
              }
            } catch (e) {
              this.logger.warn(`Failed to download media: ${(e as Error).message}`);
              content.hasMedia = true;
            }
            // For media messages, also store body as caption for frontend display
            if (message.body) {
              content.caption = message.body;
            }
          }

          // Extract location data - try multiple property paths
          if (message.location && message.location.latitude) {
            content.latitude = message.location.latitude;
            content.longitude = message.location.longitude;
            content.description = message.location.description || '';
            content.name = message.location.description || 'Location';
          } else if (message._data) {
            // Fallback: try _data.lat/_data.lng
            const lat = message._data.lat || message._data.latitude;
            const lng = message._data.lng || message._data.longitude;
            if (lat && lng) {
              content.latitude = lat;
              content.longitude = lng;
              content.description = message._data.loc || message._data.description || '';
              content.name = message._data.loc || message._data.description || 'Location';
              this.logger.log(`📍 Location from _data: ${lat}, ${lng}`);
            }
          }

          // Extract poll data - try multiple property paths
          if (msgType === 'poll_creation' || msgType === 'poll') {
            const pollName = message.pollName || message._data?.pollName || message.body;
            const pollOptions = message.pollOptions || message._data?.pollOptions;
            const allowMultipleAnswers = message.allowMultipleAnswers ?? message._data?.allowMultipleAnswers;
            if (pollName) content.question = pollName;
            if (pollName) content.pollName = pollName;
            if (pollOptions) {
              content.options = pollOptions.map?.((o: any) => typeof o === 'string' ? o : o?.name || o?.optionName || JSON.stringify(o)) || pollOptions;
              content.pollOptions = content.options;
            }
            if (allowMultipleAnswers !== undefined) content.allowMultipleAnswers = allowMultipleAnswers;
            this.logger.log(`📊 Poll data: name=${pollName}, options=${JSON.stringify(content.options)}`);
          }

          // Extract event data
          if (msgType === 'event_creation' || msgType === 'event') {
            const eventName = message.eventName || message._data?.eventName || message.body;
            const eventDesc = message.eventDescription || message._data?.eventDescription || message._data?.description;
            const eventStart = message.eventStartTime || message._data?.eventStartTime;
            const eventEnd = message.eventEndTime || message._data?.eventEndTime;
            const eventLoc = message.eventLocation || message._data?.eventLocation;
            if (eventName) content.eventName = eventName;
            if (eventDesc) content.eventDescription = eventDesc;
            if (eventStart) content.eventStartTime = eventStart;
            if (eventEnd) content.eventEndTime = eventEnd;
            if (eventLoc) content.eventLocation = eventLoc;
            this.logger.log(`📅 Event data: name=${eventName}, start=${eventStart}, loc=${eventLoc}`);
          }

          // Extract vCard/contact data
          if (message.vCards && message.vCards.length > 0) {
            content.vcard = message.vCards[0];
            // Parse vCard to extract displayName and phone
            try {
              const vcard = message.vCards[0];
              const fnMatch = vcard.match(/FN:(.*)/i);
              const telMatch = vcard.match(/TEL[^:]*:([\d+\-\s]+)/i);
              if (fnMatch) content.displayName = fnMatch[1].trim();
              if (telMatch) content.phone = telMatch[1].trim();
              // Store all vCards if multiple contacts
              if (message.vCards.length > 1) {
                content.vcards = message.vCards;
              }
            } catch (e) {
              this.logger.warn(`Failed to parse vCard: ${(e as Error).message}`);
            }
          }

          // Save message to database
          const savedMessage = await prisma.message.create({
            data: {
              profileId,
              conversationId: conversation.id,
              messageId: message.id?._serialized || message.id || `in_${Date.now()}`,
              direction: 'incoming',
              senderJid,
              type: msgType === 'chat' ? 'text' : msgType,
              content,
              status: 'received',
              timestamp: (() => {
                if (!message.timestamp) return new Date();
                // whatsapp-web.js timestamp can be in seconds or milliseconds
                const ts = Number(message.timestamp);
                const msTs = ts > 10000000000 ? ts : ts * 1000; // if > 10B, already ms
                const date = new Date(msTs);
                // Guard against invalid dates (e.g. year > 2100 or < 2000)
                if (isNaN(date.getTime()) || date.getFullYear() > 2100 || date.getFullYear() < 2000) {
                  return new Date();
                }
                return date;
              })(),
            },
          });

          // Update conversation
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: new Date(),
              unreadCount: { increment: 1 },
            },
          });

          // Emit via WebSocket for real-time chat
          this.realtime.emitMessage(profileId, {
            type: 'message:received',
            message: savedMessage,
            conversation,
          });

          // Emit on the app bus (drives webhook delivery + plugins). fromMe is
          // already skipped above.
          this.emitEvent(AppEvents.MESSAGE.RECEIVED, {
            profileId,
            id: savedMessage.id,
            from: senderJid,
            body: content.text ?? content.caption ?? '',
            type: savedMessage.type,
            hasMedia: !!(content.url || content.hasMedia),
            timestamp: savedMessage.timestamp,
            conversationId: conversation.id,
          });

          // In-app notification for the new message.
          const msgPreview = (content.text || content.caption || msgType).substring(0, 80);
          this.notifyOrgUsers(profileId, NotificationType.MESSAGE, `📨 New message from ${senderName}`,
            msgPreview, { profileId, conversationId: conversation.id, messageId: savedMessage.id, senderJid },
          ).catch(err => this.logger.warn(`Notification error (message): ${err.message}`));

          // Check if this is a new contact
          const phone = senderJid.split('@')[0];
          const existingContact = await prisma.contact.findFirst({
            where: { profileId, phone },
          });
          const isNewContact = !existingContact;
          
          // Auto-create contact if new
          if (isNewContact && phone && !isGroup) {
            await prisma.contact.create({
              data: {
                profileId,
                phone,
                name: senderName || phone,
                tags: [],
              },
            }).catch(() => {}); // Ignore duplicate errors
          }

          // === AUTOMATION: Process through the worker-local Rule Engine ===
          const incomingMsg: IncomingMessage = {
            profileId,
            conversationId: conversation.id,
            senderJid,
            senderName,
            messageType: msgType === 'chat' ? 'text' : msgType,
            content,
            timestamp: new Date(),
            isGroup,
            isNewContact,
          };

          // Fast-fail guard: skip automation when the profile is at its daily cap.
          // Uses the same warm-up-aware effective cap as the send gate. The send
          // gate owns the single counter increment (automation replies go through
          // it), so this guard must NOT increment. null cap = unlimited.
          // Automation replies are within the customer-service window, so they are
          // SERVICE traffic and hit only the overall backstop — not the cold/warm-up cap.
          const currentProfile = await prisma.profile.findUnique({ where: { id: profileId } });
          const backstop = currentProfile?.dailyMessageLimit ?? null;
          // A pending WIB reset means the counter is stale; let automation through
          // so the send gate performs its lazy reset (mirrors the pre-enqueue guard).
          const resetDue = !currentProfile?.dailyResetAt || currentProfile.dailyResetAt <= new Date();
          if (
            currentProfile &&
            backstop != null &&
            !resetDue &&
            currentProfile.dailyMessageCount >= backstop
          ) {
            this.logger.warn(`Daily message limit reached for profile ${profileId}, skipping automation`);
          } else {
            const results = await this.ruleEngine.processMessage(incomingMsg);
            for (const result of results) {
              if (result.success) {
                this.logger.log(`✅ Action "${result.action}" succeeded for ${senderJid}`);
              } else {
                this.logger.error(`❌ Action "${result.action}" failed for ${senderJid}: ${result.error || 'Unknown error'}`);
              }
            }
            if (results.length > 0) {
              this.logger.log(`Automation processed ${results.length} action(s) for message from ${senderJid}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing incoming message:`, error);
        }
      },
      onMessageAck: async (messageId: string, status: string) => {
        this.logger.log(`[ACK] Message ${messageId} → status: ${status}`);
        try {
          // The engine adapter already maps numeric ack to string status
          // (pending, sent, delivered, read, played)
          // No need for double-mapping
          
          // Read prior state before updating so the cold-circuit eval fires only on
          // the FIRST terminal transition (a message emits delivered→read→played).
          const prior = await prisma.message.findFirst({
            where: { messageId },
            select: { status: true, lane: true },
          });

          const updated = await prisma.message.updateMany({
            where: { messageId },
            data: { status },
          });

          this.logger.log(`[ACK] Updated ${updated.count} message(s) for ${messageId} → ${status}`);

          // Emit WebSocket event for real-time UI updates
          this.realtime.emitMessageAck(profileId, messageId, status);

          // Emit on the app bus only for delivery-meaningful acks (skip
          // pending/sent — 'sent' is already published by the outbound path).
          const ackEvent =
            status === 'delivered'
              ? AppEvents.MESSAGE.DELIVERED
              : status === 'read' || status === 'played'
                ? AppEvents.MESSAGE.READ
                : null;
          if (ackEvent) {
            this.emitEvent(ackEvent, { profileId, messageId, status });
          }

          // Cold-circuit health: evaluate ONCE, on the first terminal transition of a
          // COLD message (delivered/read/played = success, unknown = failure).
          const TERMINAL_ACKS = ['delivered', 'read', 'played', 'unknown'];
          const wasTerminal = prior ? TERMINAL_ACKS.includes(prior.status) : false;
          if (prior?.lane === 'cold' && !wasTerminal && TERMINAL_ACKS.includes(status)) {
            const success = status === 'delivered' || status === 'read' || status === 'played';
            const transition = await evaluateColdCircuit(profileId, success);
            if (transition === 'opened') {
              this.notifyOrgUsers(profileId, NotificationType.SYSTEM, '🧊 Cold circuit opened',
                'Cold (business-initiated) sends are paused after repeated delivery failures — the number is likely rate-locked. Replies still work; it will auto-retry after a cooldown.',
                { profileId, reason: 'cold-circuit-open' },
              ).catch((err) => this.logger.warn(`Notification error (cold-circuit-open): ${err.message}`));
            } else if (transition === 'closed') {
              this.notifyOrgUsers(profileId, NotificationType.SYSTEM, '✅ Cold circuit recovered',
                'Cold sending recovered and has resumed.',
                { profileId, reason: 'cold-circuit-closed' },
              ).catch((err) => this.logger.warn(`Notification error (cold-circuit-closed): ${err.message}`));
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to update message ack: ${(error as Error).message}`);
        }
      },
    };

    // Create and initialize the engine selected for this profile.
    const engineType = this.resolveEngineType(profile.engine);
    this.logger.log(`Initializing '${engineType}' engine for profile ${profileId}`);
    const engine = EngineFactory.create(engineType);

    try {
      await engine.initialize(engineConfig);
      
      // Store engine instance
      this.engines.set(profileId, {
        engine,
        profileId,
        status: 'connecting',
      });

      // Start connection (async, QR will come via callback)
      engine.connect().catch(async (error) => {
        this.logger.error(`Engine connect error for ${profileId}:`, error);
        
        // Clean up the failed engine instance
        try {
          await engine.destroy?.();
        } catch (e) {
          this.logger.warn(`Error destroying failed engine: ${(e as Error).message}`);
        }
        this.engines.delete(profileId);
        
        // Reset DB status to disconnected so user can retry
        try {
          await prisma.profile.update({
            where: { id: profileId },
            data: { status: 'disconnected' },
          });
        } catch (dbErr) {
          this.logger.error(`Failed to reset profile status:`, dbErr);
        }
        
        this.realtime.emitConnectionStatus(profileId, 'error');
      });

      return { status: 'connecting', message: 'Scan QR code to connect' };
    } catch (error: any) {
      this.logger.error(`Failed to initialize engine for ${profileId}:`, error);
      
      await prisma.profile.update({
        where: { id: profileId },
        data: { status: 'disconnected' },
      });

      throw error;
    }
  }

  /**
   * Disconnect a profile's WhatsApp engine
   */
  async disconnectProfile(profileId: string): Promise<{ status: string }> {
    this.logger.log(`Disconnecting profile: ${profileId}`);

    const instance = this.engines.get(profileId);
    
    if (instance) {
      try {
        await instance.engine.destroy?.();
      } catch (error) {
        this.logger.error(`Error destroying engine:`, error);
      }
      this.engines.delete(profileId);
    }

    // Update database
    await prisma.profile.update({
      where: { id: profileId },
      data: { 
        status: 'disconnected',
        sessionData: null,
      },
    });

    // Emit disconnection via WebSocket
    this.realtime.emitConnectionStatus(profileId, 'disconnected');

    return { status: 'disconnected' };
  }

  /**
   * Get engine instance for a profile
   */
  getEngine(profileId: string): IWhatsAppEngine | null {
    return this.engines.get(profileId)?.engine || null;
  }

  /**
   * Get status of a profile's engine
   */
  getEngineStatus(profileId: string): { isConnected: boolean; status: string } {
    const instance = this.engines.get(profileId);
    
    if (!instance) {
      return { isConnected: false, status: 'no_engine' };
    }

    const engineStatus = instance.engine.getStatus();
    return {
      isConnected: engineStatus.isConnected,
      status: instance.status,
    };
  }

  /**
   * Check if a profile has an active engine
   */
  hasEngine(profileId: string): boolean {
    return this.engines.has(profileId);
  }
}
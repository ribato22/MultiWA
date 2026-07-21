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
import { evaluateColdCircuit, applyAckStatusUpdate, handleAutoRejectCall, isSystemMessageType, resolveEngineType as resolveEngineTypeShared, handleInboundMessage as handleInboundMessageShared } from '@multiwa/engine-runtime';
import { EngineFactory } from '@multiwa/engines';
import type { IWhatsAppEngine, EngineConfig, EngineType } from '@multiwa/engines';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '@multiwa/core';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { RuleEngineService } from '../automation/rule-engine.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';


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
  // Guard against concurrent/duplicate history syncs for the same profile.
  private syncingHistory = new Set<string>();
  // Ready-timeout watchdog: whatsapp-web.js can fire 'authenticated' but never
  // 'ready' (intermittent upstream hang, esp. on newer WA Web builds). If a profile
  // doesn't reach 'connected' within the timeout, force a bounded reconnect so it
  // self-heals instead of sitting at "connecting" forever.
  private readyTimers = new Map<string, NodeJS.Timeout>();
  private readyTimeoutRetries = new Map<string, number>();
  private readonly READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS) || 120000;
  private readonly READY_TIMEOUT_MAX_RETRIES = Number(process.env.READY_TIMEOUT_MAX_RETRIES) || 3;

  // Periodic reconnect sweep: a safety net that reconnects profiles stuck
  // 'disconnected' but still holding a valid session (a network/hang outage that
  // outlasted the inline retries). RECONNECT_SWEEP_INTERVAL_MS=0 disables it.
  private reconnectSweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private readonly RECONNECT_SWEEP_INTERVAL_MS = Number(process.env.RECONNECT_SWEEP_INTERVAL_MS) || 180000;
  // Profiles the operator disconnected on purpose — the sweep must NOT bring these
  // back. Added on manual disconnect, cleared on manual (re)connect.
  private manuallyDisconnected = new Set<string>();

  private clearReadyTimer(profileId: string): void {
    const t = this.readyTimers.get(profileId);
    if (t) { clearTimeout(t); this.readyTimers.delete(profileId); }
  }

  // Fired when a profile authenticated but never reached 'connected' in time.
  private async onReadyTimeout(profileId: string): Promise<void> {
    this.readyTimers.delete(profileId);
    const inst = this.engines.get(profileId);
    if (!inst || inst.status === 'connected') return; // reached ready in time — nothing to do
    const retries = (this.readyTimeoutRetries.get(profileId) || 0) + 1;
    const max = this.READY_TIMEOUT_MAX_RETRIES;
    this.logger.warn(
      `Profile ${profileId} authenticated but not online within ${this.READY_TIMEOUT_MS / 1000}s ` +
      `(whatsapp-web.js ready-hang). Auto-recovery ${retries}/${max}.`,
    );
    try { await inst.engine?.destroy?.(); } catch (e) { this.logger.warn(`destroy failed: ${(e as Error).message}`); }
    this.engines.delete(profileId);
    if (retries > max) {
      this.logger.error(`Ready-timeout recovery exhausted for ${profileId}; leaving disconnected (manual reconnect needed).`);
      this.readyTimeoutRetries.delete(profileId);
      const updated = await prisma.profile
        .update({ where: { id: profileId }, data: { status: 'disconnected' }, select: { displayName: true } })
        .catch(() => null);
      this.realtime.emitConnectionStatus(profileId, 'disconnected');
      // Terminal disconnect. The ready-hang path previously emitted neither the webhook
      // event nor a user notification, so a stuck-offline profile went unnoticed.
      this.emitEvent(AppEvents.CONNECTION.DISCONNECTED, { profileId, reason: 'ready-timeout: recovery exhausted' });
      this.notifyOrgUsers(profileId, NotificationType.DISCONNECTION,
        '⚠️ Profile Disconnected',
        `${updated?.displayName || profileId} could not come online (WhatsApp Web ready-hang) and auto-recovery was exhausted. Re-link the profile.`,
        { profileId, reason: 'ready-timeout-exhausted' },
      ).catch(err => this.logger.warn(`Notification error (ready-timeout): ${err.message}`));
      return;
    }
    this.readyTimeoutRetries.set(profileId, retries);
    await prisma.profile.update({ where: { id: profileId }, data: { status: 'connecting' } }).catch(() => {});
    this.realtime.emitConnectionStatus(profileId, `reconnecting (${retries}/${max})`);
    this.connectProfile(profileId).catch(err =>
      this.logger.warn(`Ready-timeout reconnect failed for ${profileId}: ${(err as Error).message}`));
  }
  constructor(
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
    @Inject(forwardRef(() => RuleEngineService))
    private readonly ruleEngineService: RuleEngineService,
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.logger.log('EngineManagerService initialized');
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

  /** Normalize a whatsapp-web.js timestamp (sec or ms) into a sane Date. */
  private normalizeTimestamp(raw: any): Date {
    const t = Number(raw);
    if (!t) return new Date();
    const ms = t > 10_000_000_000 ? t : t * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime()) || d.getFullYear() > 2100 || d.getFullYear() < 2000) return new Date();
    return d;
  }

  /**
   * Best-effort history sync, run in the background right after a profile connects.
   * Pulls the most recent chats + their latest messages from WhatsApp and persists
   * them so existing conversations appear in the dashboard (the live stream only
   * delivers NEW messages from connect onward). Bounded by HISTORY_SYNC_CHATS /
   * HISTORY_SYNC_MESSAGES, deduped by messageId, and intentionally SILENT: no
   * automation, webhooks, or notifications fire for historical messages.
   */
  private async syncRecentHistory(profileId: string): Promise<void> {
    if (this.syncingHistory.has(profileId)) return;
    const engine = this.engines.get(profileId)?.engine as any;
    if (!engine?.getRecentChats) {
      this.logger.debug(`History sync skipped for ${profileId}: engine has no getRecentChats`);
      return;
    }
    this.syncingHistory.add(profileId);
    try {
      const chatLimit = Math.max(1, Math.min(100, Number(process.env.HISTORY_SYNC_CHATS) || 20));
      const perChat = Math.max(1, Math.min(100, Number(process.env.HISTORY_SYNC_MESSAGES) || 20));
      this.logger.log(`History sync starting for ${profileId} (chats=${chatLimit}, perChat=${perChat})`);

      const profile = await prisma.profile.findUnique({
        where: { id: profileId }, select: { phoneNumber: true },
      });
      const selfDigits = (profile?.phoneNumber || '').replace(/\D/g, '');
      const selfJid = selfDigits ? `${selfDigits}@s.whatsapp.net` : '';

      const chats = await engine.getRecentChats(chatLimit, perChat);
      let newConvos = 0, newMsgs = 0;

      // Optional webhook backfill (opt-in). Messages this sync inserts are ones the
      // live stream never saw — they'd already be in the DB otherwise — i.e. exactly
      // what arrived while the profile was disconnected. Collect the incoming ones
      // (within the window, bounded) and replay them to the webhook after the sync.
      const backfillEnabled =
        String(process.env.WEBHOOK_BACKFILL_ON_RECONNECT).toLowerCase() === 'true';
      const backfillWindowHours = Math.max(1, Number(process.env.WEBHOOK_BACKFILL_WINDOW_HOURS) || 24);
      const backfillCutoff = new Date(Date.now() - backfillWindowHours * 3_600_000);
      const BACKFILL_MAX = 200;
      const missed: Array<{
        id: string; senderJid: string; type: string;
        content: Record<string, any>; timestamp: Date; conversationId: string;
      }> = [];

      for (const chat of chats || []) {
        try {
          const rawJid: string = chat?.jid || '';
          if (!rawJid) continue;
          const isGroup = !!chat.isGroup || rawJid.includes('@g.us');
          let jid = isGroup ? rawJid : rawJid.replace('@c.us', '@s.whatsapp.net');
          if (!isGroup && jid.includes('@lid')) {
            try {
              const ident = engine.resolveIdentity ? await engine.resolveIdentity(jid) : null;
              if (ident?.phoneJid) jid = ident.phoneJid;
            } catch { /* keep lid jid */ }
          }

          let conversation = await prisma.conversation.findFirst({ where: { profileId, jid } });
          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: { profileId, jid, name: chat.name || jid, type: isGroup ? 'group' : 'user' },
            });
            newConvos++;
          }

          let lastTs: Date | null = null;
          for (const m of chat.messages || []) {
            const msgType: string = m?.type || 'chat';
            if (isSystemMessageType(msgType)) continue;
            const messageId: string = m?.id || '';
            if (!messageId) continue;
            const exists = await prisma.message.findFirst({
              where: { profileId, messageId }, select: { id: true },
            });
            if (exists) continue;

            const content: Record<string, any> = {};
            if (m.body) content.text = m.body;
            if (m.hasMedia) content.hasMedia = true;

            const fromMe = !!m.fromMe;
            const senderJid = fromMe
              ? (selfJid || jid)
              : (isGroup ? (m.author || m.from || jid) : jid);
            const ts = this.normalizeTimestamp(m.timestamp);

            const created = await prisma.message.create({
              data: {
                profileId,
                conversationId: conversation.id,
                messageId,
                direction: fromMe ? 'outgoing' : 'incoming',
                senderJid,
                type: msgType === 'chat' ? 'text' : msgType,
                content,
                status: fromMe ? 'sent' : 'received',
                timestamp: ts,
              },
            });
            newMsgs++;
            if (!lastTs || ts > lastTs) lastTs = ts;
            if (backfillEnabled && !fromMe && ts >= backfillCutoff && missed.length < BACKFILL_MAX) {
              missed.push({
                id: created.id, senderJid, type: created.type,
                content, timestamp: ts, conversationId: conversation.id,
              });
            }
          }

          if (lastTs) {
            await prisma.conversation
              .update({ where: { id: conversation.id }, data: { lastMessageAt: lastTs } })
              .catch(() => {});
          }
        } catch (err) {
          this.logger.warn(`History sync: skip chat ${chat?.jid}: ${(err as Error).message}`);
        }
      }

      this.logger.log(`History sync done for ${profileId}: +${newConvos} conversations, +${newMsgs} messages`);

      // Replay the missed incoming messages to the webhook, oldest first, using the
      // same MESSAGE.RECEIVED shape as the live path (plus a `backfilled` flag so
      // consumers can tell them apart). Automation/notifications are NOT re-run.
      if (backfillEnabled && missed.length > 0) {
        missed.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        for (const msg of missed) {
          this.emitEvent(AppEvents.MESSAGE.RECEIVED, {
            profileId,
            id: msg.id,
            from: msg.senderJid,
            body: msg.content?.text ?? msg.content?.caption ?? '',
            type: msg.type,
            hasMedia: !!(msg.content?.url || msg.content?.hasMedia),
            timestamp: msg.timestamp,
            conversationId: msg.conversationId,
            backfilled: true,
          });
        }
        this.logger.log(`Webhook backfill: replayed ${missed.length} missed incoming message(s) for ${profileId} (window ${backfillWindowHours}h)`);
      }
    } finally {
      this.syncingHistory.delete(profileId);
    }
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
    // When the engine is hosted in the worker, the API must NOT reset profile
    // status or auto-reconnect sessions — the worker owns them. Skipping this is
    // the anti-split-brain guard (no two processes connecting the same session).
    if (process.env.ENGINE_HOST === 'worker') {
      this.logger.warn('ENGINE_HOST=worker: API EngineManagerService skipping autoReconnect (worker owns sessions)');
      return;
    }

    this.logger.log('EngineManagerService initializing...');

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

        staleProfiles.forEach(p => {
          this.logger.log(`Reset profile to disconnected: ${p.displayName || p.id}`);
        });
      }

      // Step 2: Auto-reconnect profiles that have valid session data
      await this.autoReconnectProfiles();

      // Step 3: Start the periodic reconnect sweep (safety net for outages that
      // outlast the inline retries). API mode only — the worker path returned early.
      if (this.RECONNECT_SWEEP_INTERVAL_MS > 0) {
        this.reconnectSweepTimer = setInterval(() => {
          this.reconnectSweep().catch(err =>
            this.logger.warn(`Reconnect sweep tick error: ${(err as Error).message}`));
        }, this.RECONNECT_SWEEP_INTERVAL_MS);
        this.logger.log(`Reconnect sweep enabled (every ${Math.round(this.RECONNECT_SWEEP_INTERVAL_MS / 1000)}s)`);
      }

    } catch (error) {
      this.logger.error('Error in onModuleInit:', error);
    }
  }

  /**
   * True if the profile has on-disk session credentials — a whatsapp-web.js
   * LocalAuth dir (`session-<id>/`) or a Baileys `creds.json` — i.e. it can
   * reconnect without a fresh QR scan. A logged-out profile has neither.
   */
  private async hasValidSession(profileId: string): Promise<boolean> {
    const fs = await import('fs/promises');
    const sessionsDir = process.env.SESSIONS_DIR || '/data/sessions';
    const sessionDir = path.join(sessionsDir, profileId);
    try { await fs.access(path.join(sessionDir, `session-${profileId}`)); return true; } catch { /* not wwebjs */ }
    try { await fs.access(path.join(sessionDir, 'creds.json')); return true; } catch { /* not baileys */ }
    return false;
  }

  /**
   * Periodic safety net: reconnect profiles stuck 'disconnected' that still hold a
   * valid session (e.g. a network/hang outage that outlasted the inline retries).
   * Skips profiles the operator disconnected on purpose, those already
   * (re)connecting, and logged-out sessions (which need a fresh QR). Runs forever
   * on RECONNECT_SWEEP_INTERVAL_MS so an outage of any length eventually recovers.
   */
  private async reconnectSweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const profiles = await prisma.profile.findMany({
        where: { status: 'disconnected' },
        select: { id: true, displayName: true },
      });
      let attempted = 0;
      for (const profile of profiles) {
        if (this.manuallyDisconnected.has(profile.id)) continue; // intentional disconnect
        if (this.engines.has(profile.id)) continue;              // already (re)connecting
        if (!(await this.hasValidSession(profile.id))) continue;  // logged out — needs QR
        this.logger.log(`Reconnect sweep: attempting ${profile.displayName || profile.id}`);
        this.connectProfile(profile.id).catch(err =>
          this.logger.warn(`Reconnect sweep failed for ${profile.displayName || profile.id}: ${(err as Error).message}`));
        attempted++;
        await new Promise(r => setTimeout(r, 2000)); // pace, don't overwhelm WhatsApp
      }
      if (attempted > 0) this.logger.log(`Reconnect sweep attempted ${attempted} profile(s)`);
    } catch (err) {
      this.logger.warn(`Reconnect sweep error: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
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
        if (!(await this.hasValidSession(profile.id))) {
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
    if (this.reconnectSweepTimer) {
      clearInterval(this.reconnectSweepTimer);
      this.reconnectSweepTimer = null;
    }
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
    return resolveEngineTypeShared(engineField, {
      defaultEngine: process.env.DEFAULT_ENGINE,
      warn: (m) => this.logger.warn(m),
    });
  }

  /**
   * Initialize and connect a WhatsApp engine for a profile
   */

  /**
   * Handle one inbound WhatsApp message: skip own/system messages, dedup the
   * conversation (incl. @lid resolution + group-subject), build the content
   * object, persist the message, update the conversation (+ optional auto-read),
   * emit realtime + app-bus + notification, auto-create the contact, and run
   * automation. Extracted verbatim from the onMessage engine callback so the API
   * and worker can share one implementation; behaviour is identical.
   * See architecture/engine-worker-migration-sop.md.
   */
  private async handleInboundMessage(message: any, profileId: string): Promise<void> {
    await handleInboundMessageShared(message, profileId, {
      logger: this.logger,
      getEngine: () => this.engines.get(profileId)?.engine,
      resolveGroupName: (jid, fallback) => this.resolveGroupName(profileId, jid, fallback),
      emitRealtime: (payload) => this.realtime.emitMessage(profileId, payload),
      emitMessageReceived: (payload) => this.emitEvent(AppEvents.MESSAGE.RECEIVED, payload),
      notify: (title, body, meta) => this.notifyOrgUsers(profileId, NotificationType.MESSAGE, title, body, meta),
      processAutomation: (msg) => this.ruleEngineService.processMessage(msg),
      autoReadOnReceive: process.env.AUTO_READ_ON_RECEIVE === 'true',
    });
  }
  async connectProfile(profileId: string): Promise<{ status: string; message: string }> {
    // Defense-in-depth: profileId is server-generated (uuid) and the DB lookup below
    // already rejects unknown ids, but validate the shape up front so it can NEVER
    // reach the SESSIONS_DIR/<profileId> filesystem paths (path traversal) even if a
    // future caller skips the lookup.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
      throw new Error('Invalid profileId');
    }
    this.logger.log(`Connecting profile: ${profileId}`);
    // A (re)connect clears any "manually disconnected" marker so the reconnect
    // sweep watches this profile again.
    this.manuallyDisconnected.delete(profileId);

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
        // Reached 'ready' — cancel the watchdog and reset its retry counter.
        this.clearReadyTimer(profileId);
        this.readyTimeoutRetries.delete(profileId);

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

        // === Notification: profile connected ===
        this.notifyOrgUsers(profileId, NotificationType.CONNECTION,
          '✅ Profile Connected',
          `${profile.displayName || phone} is now connected`,
          { profileId, phone },
        ).catch(err => this.logger.warn(`Notification error (connection): ${err.message}`));

        // Background, best-effort: pull recent chats + their latest messages so
        // existing conversations show up in the dashboard (whatsapp-web.js only
        // streams NEW messages from connect onward). Bounded + deduped; never blocks
        // connect. Disable with HISTORY_SYNC_ON_CONNECT=false.
        if (process.env.HISTORY_SYNC_ON_CONNECT !== 'false') {
          this.syncRecentHistory(profileId).catch(err =>
            this.logger.warn(`History sync failed for ${profileId}: ${(err as Error).message}`));
        }
      },
      onDisconnected: async (reason: string) => {
        this.logger.log(`Profile ${profileId} disconnected: ${reason}`);
        this.clearReadyTimer(profileId);

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

          // === Notification: session invalidated ===
          this.notifyOrgUsers(profileId, NotificationType.DISCONNECTION,
            '⚠️ Profile Disconnected',
            `${profile.displayName || profileId} was disconnected: ${reason}`,
            { profileId, reason },
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
          // A transient disconnect that never recovered is a terminal state an operator
          // should act on — notify org users (previously only session-invalidation did).
          this.notifyOrgUsers(profileId, NotificationType.DISCONNECTION,
            '⚠️ Profile Disconnected',
            `${profile.displayName || profileId} disconnected (${reason}) and auto-recovery failed after ${maxRetries} attempts. Manual reconnect needed.`,
            { profileId, reason: 'max-retries-exhausted' },
          ).catch(err => this.logger.warn(`Notification error (retry-exhausted): ${err.message}`));
        }
      },
      onMessage: async (message: any) => this.handleInboundMessage(message, profileId),
      onMessageAck: async (messageId: string, status: string) => {
        try {
          // Shared, guarded ack update: a null result means the ack had no resolvable
          // id and was skipped. The guard lives in applyAckStatusUpdate so both
          // engine-manager forks share ONE implementation (an absent id would otherwise
          // degrade updateMany to WHERE 1=1 and rewrite every message + deadlock).
          const ack = await applyAckStatusUpdate(messageId, status);
          if (!ack) {
            this.logger.warn(`[ACK] Ignoring ack with no message id (status: ${status})`);
            return;
          }
          const { prior, count } = ack;
          this.logger.log(`[ACK] Message ${messageId} → status: ${status} (updated ${count})`);

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

          // Cold-circuit health: evaluate the breaker ONCE, on the first terminal
          // transition of a COLD message (delivered/read/played = success, unknown =
          // failure). Later acks on the same message don't re-run the state machine.
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
      onCall: async (call) => {
        try {
          const p = await prisma.profile.findUnique({ where: { id: profileId }, select: { settings: true } });
          const eng = this.getEngine(profileId);
          if (!eng) return;
          await handleAutoRejectCall(call, (p?.settings ?? {}) as any, {
            rejectCall: (id) => eng.rejectCall(id),
            sendText: async (to, text) => { await eng.sendText(to, text); },
            logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
          });
        } catch (e) {
          this.logger.warn(`onCall handler failed: ${(e as Error).message}`);
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
        
        this.clearReadyTimer(profileId);
        this.realtime.emitConnectionStatus(profileId, 'error');
      });

      // Arm the ready-timeout watchdog. Cleared on 'ready' (onReady) or 'disconnected'.
      this.clearReadyTimer(profileId);
      this.readyTimers.set(profileId, setTimeout(() => {
        this.onReadyTimeout(profileId).catch(err =>
          this.logger.warn(`Ready-timeout handler error for ${profileId}: ${(err as Error).message}`));
      }, this.READY_TIMEOUT_MS));

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
    // Operator-initiated disconnect — mark it so the reconnect sweep does not
    // bring it back. Cleared when the operator connects it again.
    this.manuallyDisconnected.add(profileId);

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

  /**
   * Helper: find profile's org and create notifications for all org users
   */
  private async notifyOrgUsers(
    profileId: string,
    type: NotificationType,
    title: string,
    body: string,
    metadata?: Record<string, any>,
  ) {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { workspace: { select: { organizationId: true } } },
    });

    const orgId = profile?.workspace?.organizationId;
    if (!orgId) {
      this.logger.warn(`Cannot send notification: profile ${profileId} has no organization`);
      return;
    }

    return this.notificationsService.createForOrg(orgId, type, title, body, metadata);
  }
}
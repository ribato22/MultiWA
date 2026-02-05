// MultiWA Gateway API - Engine Manager Service
// apps/api/src/modules/profiles/engine-manager.service.ts
//
// This service manages WhatsApp engine instances and wires them to EventsGateway

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { prisma } from '@multiwa/database';
import { WhatsAppWebJsAdapter } from '@multiwa/engines';
import type { IWhatsAppEngine, EngineConfig } from '@multiwa/engines';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { RuleEngineService, IncomingMessage } from '../automation/rule-engine.service';
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

  constructor(
    private readonly eventsGateway: EventsGateway,
    @Inject(forwardRef(() => RuleEngineService))
    private readonly ruleEngineService: RuleEngineService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.logger.log('EngineManagerService initialized');
  }

  /**
   * On module init:
   * 1. Reset stale 'connected' profiles to 'disconnected'
   * 2. Auto-reconnect profiles that have valid session data
   */
  async onModuleInit() {
    this.logger.log('EngineManagerService initializing...');
    
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
        // whatsapp-web.js LocalAuth stores data in {dataPath}/.wwebjs_auth/session-{clientId}/
        const wwebjsSessionDir = path.join(sessionDir, '.wwebjs_auth', `session-${profile.id}`);
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
          this.eventsGateway.emitQrUpdate(profileId, qrDataUrl);
          this.logger.log(`QR code emitted via WebSocket for profile ${profileId}`);
        } catch (error) {
          this.logger.error(`Error generating QR data URL:`, error);
          // Fallback: send raw QR string
          this.eventsGateway.emitQrUpdate(profileId, qr);
        }
      },
      onReady: async (phone: string, pushName: string) => {
        this.logger.log(`Profile ${profileId} connected: ${phone} (${pushName})`);
        
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
        this.eventsGateway.emitConnectionStatus(profileId, 'connected', phone);

        // === Notification: profile connected ===
        this.notifyOrgUsers(profileId, NotificationType.CONNECTION,
          '✅ Profile Connected',
          `${profile.displayName || phone} is now connected`,
          { profileId, phone },
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
          this.eventsGateway.emitConnectionStatus(profileId, 'disconnected');

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
            this.eventsGateway.emitConnectionStatus(profileId, `reconnecting (${attempt}/${maxRetries})`);
            
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
          this.eventsGateway.emitConnectionStatus(profileId, 'disconnected');
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
          const senderJid = isGroup ? rawSenderJid : rawSenderJid.replace('@c.us', '@s.whatsapp.net');
          const senderName = message._data?.notifyName || message.pushName || senderJid.split('@')[0];
          
          // Get or create conversation — use normalized JID
          const rawJid = message.from || '';
          const jid = isGroup ? rawJid : rawJid.replace('@c.us', '@s.whatsapp.net');
          let conversation = await prisma.conversation.findFirst({
            where: { profileId, jid },
          });
          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                profileId,
                jid,
                name: senderName || jid,
                type: isGroup ? 'group' : 'user',
              },
            });
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
          this.eventsGateway.emitMessage(profileId, {
            type: 'message:received',
            message: savedMessage,
            conversation,
          });

          // === Notification: new message ===
          const msgPreview = (content.text || content.caption || msgType).substring(0, 80);
          this.notifyOrgUsers(profileId, NotificationType.MESSAGE,
            `📨 New message from ${senderName}`,
            msgPreview,
            { profileId, conversationId: conversation.id, messageId: savedMessage.id, senderJid },
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

          // === AUTOMATION: Process through Rule Engine ===
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

          // Check daily message limit before processing automations
          const currentProfile = await prisma.profile.findUnique({ where: { id: profileId } });
          if (currentProfile && currentProfile.dailyMessageLimit > 0 && currentProfile.dailyMessageCount >= currentProfile.dailyMessageLimit) {
            this.logger.warn(`Daily message limit reached for profile ${profileId}: ${currentProfile.dailyMessageCount}/${currentProfile.dailyMessageLimit}, skipping automation`);
          } else {
            const results = await this.ruleEngineService.processMessage(incomingMsg);
          
            // Log and handle automation action results
            for (const result of results) {
              if (result.success) {
                this.logger.log(`✅ Action "${result.action}" succeeded for ${senderJid}${result.data?.message ? `: ${(result.data.message as string).substring(0, 50)}...` : ''}`);
                
                // Increment daily message count for actions that send messages
                const sendingActions = ['reply', 'send_image', 'send_document', 'send_poll', 'send_audio', 'send_video', 'send_location', 'send_contact'];
                if (sendingActions.includes(result.action)) {
                  try {
                    await prisma.profile.update({
                      where: { id: profileId },
                      data: { 
                        dailyMessageCount: { increment: 1 },
                        ...(currentProfile && currentProfile.dailyResetAt && new Date() > currentProfile.dailyResetAt ? {
                          dailyResetAt: new Date(new Date().setHours(24, 0, 0, 0)),
                          dailyMessageCount: 1,
                        } : {}),
                      },
                    });
                  } catch (e) {
                    this.logger.warn(`Failed to update daily message count: ${(e as Error).message}`);
                  }
                }
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
          
          const updated = await prisma.message.updateMany({
            where: { messageId },
            data: { status },
          });

          this.logger.log(`[ACK] Updated ${updated.count} message(s) for ${messageId} → ${status}`);

          // Emit WebSocket event for real-time UI updates
          this.eventsGateway.emitMessageAck(profileId, messageId, status);
        } catch (error) {
          this.logger.warn(`Failed to update message ack: ${(error as Error).message}`);
        }
      },
    };

    // Create and initialize engine (using whatsapp-web.js for better group support)
    const engine = new WhatsAppWebJsAdapter();
    
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
        
        this.eventsGateway.emitConnectionStatus(profileId, 'error');
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
    this.eventsGateway.emitConnectionStatus(profileId, 'disconnected');

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

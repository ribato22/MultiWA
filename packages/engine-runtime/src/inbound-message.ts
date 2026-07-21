// packages/engine-runtime/src/inbound-message.ts
//
// Handle one inbound WhatsApp message end-to-end: skip own/system messages, dedup
// the conversation (incl. @lid resolution + group-subject), build the content
// object (text/media/location/poll/event/vCard), persist the message, update the
// conversation (+ optional auto-read), emit realtime + app-bus + notification,
// auto-create the contact, and run automation.
//
// Extracted verbatim from the API engine-manager's onMessage handler and shared
// with apps/worker so both engine-managers run ONE implementation; the injected
// deps carry the per-process collaborators (realtime emitter, notifications,
// rule engine, engine access). Behaviour is identical to the pre-extraction API
// path — locked by apps/api/.../handle-inbound-message.spec.ts.
// See architecture/engine-worker-migration-sop.md.

import { prisma } from '@multiwa/database';
import { serializeWaMessageId } from './wa-message-id';
import { isSystemMessageType } from './system-message';
import { applyInboundMedia } from './inbound-media';

/** The shape apps/api and apps/worker both use for rule-engine input. */
export interface IncomingMessage {
  profileId: string;
  conversationId: string;
  senderJid: string;
  senderName: string;
  messageType: string;
  content: any;
  timestamp: Date;
  isGroup: boolean;
  isNewContact: boolean;
}

export interface InboundAutomationResult {
  success: boolean;
  action: string;
  error?: string;
  data?: any;
}

export interface InboundMessageDeps {
  /** Per-process logger (NestJS Logger instance). */
  logger: { log(m: string): void; warn(m: string): void; error(m: string, e?: unknown): void; debug(m: string): void };
  /** The live engine for this profile (for @lid resolveIdentity + auto-read markAsRead). */
  getEngine: () => any;
  /** Resolve a group jid's subject, pre-bound to the profile. */
  resolveGroupName: (jid: string, fallback: string) => Promise<string>;
  /** Realtime push, pre-bound to the profile (Socket.IO gateway on api, Redis publisher on worker). */
  emitRealtime: (payload: any) => void;
  /** App-bus MESSAGE.RECEIVED emit (drives webhook delivery + plugins), pre-bound to the profile. */
  emitMessageReceived: (payload: Record<string, unknown>) => void;
  /** Operator notification (pre-scoped to NotificationType.MESSAGE + the profile). */
  notify: (title: string, body: string, meta: Record<string, unknown>) => Promise<unknown>;
  /** Run automation for the message (RuleEngineService on api, WorkerRuleEngineService on worker). */
  processAutomation: (msg: IncomingMessage) => Promise<InboundAutomationResult[]>;
  /** process.env.AUTO_READ_ON_RECEIVE === 'true'. */
  autoReadOnReceive: boolean;
}

export async function handleInboundMessage(message: any, profileId: string, deps: InboundMessageDeps): Promise<void> {
        // Skip bot's own messages to prevent reply loops
        if (message.fromMe) {
          deps.logger.debug(`Skipping own message for profile ${profileId}`);
          return;
        }
        // Skip WhatsApp system/protocol messages — these are not real chat content
        // (E2E-encryption notices, business notification templates, call logs,
        // group-system events, deleted-message markers). Persisting them produced
        // bogus "conversations" with unresolved @lid numbers and noisy notifications.
        if (isSystemMessageType(message.type)) {
          deps.logger.debug(`Skipping system message (type=${message.type}) for profile ${profileId}`);
          return;
        }
        deps.logger.log(`📨 Incoming message for profile ${profileId} from ${message.from}: type=${message.type}, body=${(message.body || '').substring(0, 50)}`);
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
              const lidEngine = deps.getEngine();
              const ident = lidEngine?.resolveIdentity ? await lidEngine.resolveIdentity(jid) : null;
              if (ident?.phoneJid) { jid = ident.phoneJid; senderJid = ident.phoneJid; }
              if (ident?.name) senderName = ident.name;
            } catch (err) {
              deps.logger.warn(`LID resolve failed for ${jid}: ${(err as Error).message}`);
            }
          }
          let conversation = await prisma.conversation.findFirst({
            where: { profileId, jid },
          });
          // For groups, use the real WhatsApp group subject — not the sender's name.
          const groupName = isGroup ? await deps.resolveGroupName(jid, senderName || jid) : null;
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
            deps.logger.log(`🔍 Special msg type=${msgType}, keys=${Object.keys(message).join(',')}`);
            deps.logger.log(`🔍 message.location=${JSON.stringify(message.location)}`);
            deps.logger.log(`🔍 message.pollName=${message.pollName}, message.pollOptions=${JSON.stringify(message.pollOptions)}`);
            if (message._data) {
              deps.logger.log(`🔍 message._data keys=${Object.keys(message._data).join(',')}`);
              deps.logger.log(`🔍 message._data.lat=${message._data.lat}, message._data.lng=${message._data.lng}`);
              deps.logger.log(`🔍 message._data.pollName=${message._data.pollName}`);
              deps.logger.log(`🔍 message._data.pollOptions=${JSON.stringify(message._data.pollOptions)}`);
              deps.logger.log(`🔍 message._data.eventName=${message._data.eventName}`);
              deps.logger.log(`🔍 message._data.eventDescription=${message._data.eventDescription}`);
              deps.logger.log(`🔍 message._data.eventStartTime=${message._data.eventStartTime}`);
              deps.logger.log(`🔍 message._data relevant=${JSON.stringify({
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
              // Shared: sets mimetype/filename/hasMedia and inlines the base64 data
              // URL only when it's under the size cap (oversized media is flagged,
              // not stored, to avoid bloating Postgres).
              applyInboundMedia(content, media);
            } catch (e) {
              deps.logger.warn(`Failed to download media: ${(e as Error).message}`);
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
              deps.logger.log(`📍 Location from _data: ${lat}, ${lng}`);
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
            deps.logger.log(`📊 Poll data: name=${pollName}, options=${JSON.stringify(content.options)}`);
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
            deps.logger.log(`📅 Event data: name=${eventName}, start=${eventStart}, loc=${eventLoc}`);
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
              deps.logger.warn(`Failed to parse vCard: ${(e as Error).message}`);
            }
          }

          // Save message to database
          const savedMessage = await prisma.message.create({
            data: {
              profileId,
              conversationId: conversation.id,
              messageId: serializeWaMessageId(message),
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

          // Update conversation. AUTO_READ_ON_RECEIVE (default off): when enabled,
          // immediately send "seen" to WhatsApp (marks read on the phone) and keep
          // the dashboard unread count at zero so both stay consistent.
          const autoRead = deps.autoReadOnReceive;
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              // Use the message's real timestamp (from WhatsApp), not the server
              // clock — resilient to host clock skew/drift on air-gapped boxes.
              lastMessageAt: savedMessage.timestamp,
              unreadCount: autoRead ? 0 : { increment: 1 },
            },
          });
          if (autoRead) {
            try {
              await deps.getEngine()?.markAsRead?.(jid);
            } catch (err) {
              deps.logger.warn(`Auto-read failed for ${jid}: ${(err as Error).message}`);
            }
          }

          // Emit via WebSocket for real-time chat
          deps.emitRealtime({
            type: 'message:received',
            message: savedMessage,
            conversation,
          });

          // Emit on the app bus (drives webhook delivery + plugins). fromMe is
          // already skipped above.
          deps.emitMessageReceived({
            profileId,
            id: savedMessage.id,
            from: senderJid,
            body: content.text ?? content.caption ?? '',
            type: savedMessage.type,
            hasMedia: !!(content.url || content.hasMedia),
            timestamp: savedMessage.timestamp,
            conversationId: conversation.id,
          });

          // === Notification: new message ===
          const msgPreview = (content.text || content.caption || msgType).substring(0, 80);
          deps.notify(
            `📨 New message from ${senderName}`,
            msgPreview,
            { profileId, conversationId: conversation.id, messageId: savedMessage.id, senderJid },
          ).catch(err => deps.logger.warn(`Notification error (message): ${err.message}`));

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

          // Fast-fail guard: skip automation entirely when the profile is at its
          // daily cap. Uses the same warm-up-aware effective cap as the send gate
          // so this short-circuit matches what the gate would enforce. The actual
          // counter increment is owned by SendGateService (every automation reply
          // ultimately goes through MessagesService → the send gate), so
          // incrementing here too would double-count. null cap means unlimited.
          // Automation replies are within the customer-service window (the sender
          // just messaged us), so they are SERVICE traffic and hit only the overall
          // backstop — never the cold/warm-up cap, which would wrongly skip replies.
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
            deps.logger.warn(`Daily message limit reached for profile ${profileId}: ${currentProfile.dailyMessageCount}/${backstop}, skipping automation`);
          } else {
            const results = await deps.processAutomation(incomingMsg);

            // Log automation action results. Counter increments happen in the
            // send gate, not here (see note above).
            for (const result of results) {
              if (result.success) {
                deps.logger.log(`✅ Action "${result.action}" succeeded for ${senderJid}${result.data?.message ? `: ${(result.data.message as string).substring(0, 50)}...` : ''}`);
              } else {
                deps.logger.error(`❌ Action "${result.action}" failed for ${senderJid}: ${result.error || 'Unknown error'}`);
              }
            }

            if (results.length > 0) {
              deps.logger.log(`Automation processed ${results.length} action(s) for message from ${senderJid}`);
            }
          }
        } catch (error) {
          deps.logger.error(`Error processing incoming message:`, error);
        }
  }

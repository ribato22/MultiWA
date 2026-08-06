// MultiWA Gateway - Baileys Adapter (SECONDARY ENGINE)
// packages/engines/src/adapters/baileys.adapter.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WAMessageContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import type {
  IWhatsAppEngine,
  EngineConfig,
  EngineStatus,
  MessageResult,
  MediaOptions,
  LocationOptions,
  ContactOptions,
  PollOptions,
  SendMessageOptions,
} from '../types';


export class BaileysAdapter implements IWhatsAppEngine {
  readonly engineType = 'baileys' as const;

  private socket: ReturnType<typeof makeWASocket> | null = null;
  private config: EngineConfig | null = null;
  private status: EngineStatus = {
    isConnected: false,
    isAuthenticated: false,
  };
  private currentQR: string | null = null;
  private qrCallbacks: ((qr: string) => void)[] = [];
  // Caller JID per call id — Baileys' rejectCall(id, from) needs both.
  private callFrom = new Map<string, string>();
  private authState: any = null;
  private connectionRetryCount: number = 0;
  private maxConnectionRetries: number = 3;
  // Single-authority reconnect state. Baileys owns its own reconnection internally so it never
  // competes with EngineManager's onDisconnected auto-retry (a double-reconnect spawns multiple
  // sockets, each emitting a fresh pairing QR every few seconds → impossible to scan).
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting: boolean = false;
  private hasAuthenticated: boolean = false;

  async initialize(config: EngineConfig): Promise<void> {
    this.config = config;
    const sessionDir = config.sessionDir || `./sessions/${config.profileId}`;

    // Load auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    this.authState = { state, saveCreds };
  }

  async connect(): Promise<void> {
    if (!this.authState) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    // Cancel any pending reconnect and tear down a prior socket. Each event handler is bound to
    // the socket instance that created it (see setupEventHandlers' isCurrent guard), so the old
    // socket's late 'close' can't schedule another reconnect once it's been replaced.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      // Null the field BEFORE end(): Baileys' end() emits 'connection.update' { connection:'close' }
      // SYNCHRONOUSLY. If this.socket still pointed at the dying socket, isCurrent() would be true
      // and the close handler would schedule a spurious reconnect on every teardown.
      const dying = this.socket;
      this.socket = null;
      try {
        dying.end(undefined as any);
      } catch {
        /* ignore */
      }
    }

    // Resolve the WhatsApp Web version. On air-gapped hosts fetchLatestBaileysVersion()
    // cannot reach GitHub: it hangs ~75s on the dropped SYN, then falls back to a STALE
    // bundled version that WhatsApp rejects at the noise handshake ("Connection Failure",
    // no QR). Pin a current version via BAILEYS_WA_VERSION="2.3000.1035194821" to skip the
    // fetch entirely and present a working QR. Falls back to the live fetch when unset.
    let version: [number, number, number];
    const pinnedVer = process.env.BAILEYS_WA_VERSION;
    if (pinnedVer && /^\d+\.\d+\.\d+$/.test(pinnedVer.trim())) {
      version = pinnedVer.trim().split('.').map(Number) as [number, number, number];
      console.log(`[Baileys] Using pinned WA version ${version.join('.')}`);
    } else {
      const fetched = await fetchLatestBaileysVersion();
      version = fetched.version as [number, number, number];
      console.log(`[Baileys] Using fetched WA version ${version.join('.')}`);
    }

    this.socket = makeWASocket({
      version,
      auth: {
        creds: this.authState.state.creds,
        keys: makeCacheableSignalKeyStore(
          this.authState.state.keys,
          console as any
        ),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
    });

    this.setupEventHandlers();
  }

  // Single, debounced reconnect. Any pending timer is replaced, and an in-flight reconnect is
  // never re-entered, so at most one socket is ever (re)created per close — the key to a stable,
  // scannable pairing QR.
  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    console.log(`[Baileys] Reconnecting in ${delay}ms for ${this.config?.profileId}...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isReconnecting) return;
      this.isReconnecting = true;
      let failed = false;
      try {
        await this.connect();
      } catch (err: any) {
        failed = true;
        console.error(`[Baileys] Reconnect failed for ${this.config?.profileId}: ${err?.message}`);
      } finally {
        this.isReconnecting = false;
      }
      // Self-heal: a thrown connect() (e.g. a transient init error) fires no 'close' event, so
      // without this the profile would sit at "connecting" with no further attempts. Back off and
      // retry; EngineManager's ready-timeout watchdog remains the outer backstop. destroy() flips
      // isReconnecting=true, which makes the next tick return early and stops the loop.
      if (failed) {
        this.connectionRetryCount++;
        this.scheduleReconnect(Math.min(3000 * (this.connectionRetryCount + 1), 15000));
      }
    }, delay);
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Bind every handler to the socket that created it. After connect() replaces this.socket,
    // a stale socket's late events (especially 'close') must be ignored so they can't schedule
    // a reconnect or process messages against an obsolete session.
    const sock = this.socket;
    const isCurrent = () => this.socket === sock;

    // Incoming voice/video call — surface the initial offer for auto-reject.
    this.socket.ev.on('call', (calls: any[]) => {
      if (!isCurrent()) return;
      for (const call of calls || []) {
        if (call?.status && call.status !== 'offer') continue;
        if (call?.id && call?.from) this.callFrom.set(call.id, call.from);
        this.config?.onCall?.({
          id: call?.id,
          from: call?.from || '',
          isVideo: !!call?.isVideo,
          isGroup: (call?.from || '').includes('@g.us'),
        });
      }
    });

    // Connection update
    this.socket.ev.on('connection.update', async (update) => {
      if (!isCurrent()) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[Baileys] QR Code received for profile ${this.config?.profileId}`);
        this.currentQR = qr;
        qrcode.generate(qr, { small: true });
        this.qrCallbacks.forEach((cb) => cb(qr));
        this.config?.onQR?.(qr);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        // 515 restartRequired is the EXPECTED close right after a successful QR scan: Baileys
        // must restart the socket to finish login. It is NOT a failure.
        const isRestartRequired = statusCode === DisconnectReason.restartRequired;
        const isConnectionFailure = lastDisconnect?.error?.message?.includes('Connection Failure');

        console.log(
          `[Baileys] Connection closed for ${this.config?.profileId}. statusCode=${statusCode} loggedOut=${isLoggedOut} restartRequired=${isRestartRequired} retries=${this.connectionRetryCount}`
        );

        this.status = { isConnected: false, isAuthenticated: false };

        // Terminal: logged out. Bubble to the manager so it clears the session for a fresh QR.
        // Do NOT reconnect — the credentials are gone.
        if (isLoggedOut) {
          this.connectionRetryCount = 0;
          this.config?.onDisconnected?.('Logged Out');
          return;
        }

        // Post-scan re-login step. Reconnect immediately and internally; never bubble to the
        // manager (that would destroy/recreate the engine and abort the in-progress pairing).
        if (isRestartRequired) {
          this.scheduleReconnect(0);
          return;
        }

        // Repeated hard connection failures => likely a stale session. Clear it and ask the
        // user (via the manager) for a fresh QR.
        if (isConnectionFailure) {
          this.connectionRetryCount++;
          if (this.connectionRetryCount >= this.maxConnectionRetries) {
            console.log(`[Baileys] Max retries (${this.maxConnectionRetries}) reached for ${this.config?.profileId}. Clearing stale session...`);
            const sessionDir = this.config?.sessionDir || `./sessions/${this.config?.profileId}`;
            try {
              for (const file of fs.readdirSync(sessionDir)) {
                fs.unlinkSync(path.join(sessionDir, file));
              }
              console.log(`[Baileys] Session cleared for ${this.config?.profileId}.`);
            } catch (err: any) {
              console.error(`[Baileys] Failed to clear session: ${err.message}`);
            }
            this.connectionRetryCount = 0;
            this.config?.onDisconnected?.('Session Expired. Please reconnect.');
            return;
          }
        } else {
          this.connectionRetryCount = 0;
        }

        // QR-pairing phase or a transient drop. Reconnect INTERNALLY only (single authority).
        // We deliberately do NOT call onDisconnected here: that would trigger EngineManager's own
        // auto-retry, producing a second competing socket whose QR overwrites this one every few
        // seconds — the exact bug that made the pairing QR unscannable.
        this.scheduleReconnect(Math.min(3000 * (this.connectionRetryCount + 1), 15000));
      }

      if (connection === 'open') {
        console.log(`[Baileys] Connected for profile ${this.config?.profileId}`);
        this.connectionRetryCount = 0; // Reset retry counter on successful connection
        this.hasAuthenticated = true;
        this.status = {
          isConnected: true,
          isAuthenticated: true,
          phone: this.socket?.user?.id?.split(':')[0],
          pushName: this.socket?.user?.name,
          lastConnectedAt: new Date(),
        };
        this.currentQR = null;
        this.config?.onReady?.(
          this.socket?.user?.id?.split(':')[0] || '',
          this.socket?.user?.name || ''
        );
      }
    });

    // Credentials update
    this.socket.ev.on('creds.update', this.authState.saveCreds);

    // Messages
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!isCurrent()) return;
      if (type !== 'notify') return;

      for (const message of messages) {
        if (message.key.fromMe) continue;

        const transformedMessage = {
          id: message.key.id,
          from: message.key.remoteJid,
          to: this.socket?.user?.id,
          body: message.message?.conversation ||
            message.message?.extendedTextMessage?.text || '',
          type: this.getMessageType(message.message),
          timestamp: new Date(
            (message.messageTimestamp as number) * 1000
          ),
          isGroup: message.key.remoteJid?.endsWith('@g.us') || false,
          hasMedia: !!message.message?.imageMessage ||
            !!message.message?.videoMessage ||
            !!message.message?.audioMessage ||
            !!message.message?.documentMessage,
          fromMe: false,
        };

        this.config?.onMessage?.(transformedMessage);
      }
    });

    // Message status
    this.socket.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        if (update.update.status) {
          const statusMap: Record<number, string> = {
            1: 'pending',
            2: 'sent',
            3: 'delivered',
            4: 'read',
          };
          this.config?.onMessageAck?.(
            update.key.id || '',
            statusMap[update.update.status] || 'unknown'
          );
        }
      }
    });
  }

  private getMessageType(message: WAMessageContent | null | undefined): string {
    if (!message) return 'unknown';
    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.locationMessage) return 'location';
    if (message.contactMessage) return 'contact';
    if (message.stickerMessage) return 'sticker';
    return 'unknown';
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      await this.socket.logout();
      this.status = { isConnected: false, isAuthenticated: false };
    }
  }

  async destroy(): Promise<void> {
    // Cancel any pending reconnect and block an in-flight one from re-creating a socket on an
    // instance the manager is about to discard (otherwise a zombie connection leaks).
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = true;
    if (this.socket) {
      // Null first (see connect()): end() emits 'close' synchronously; isCurrent() must be false.
      const dying = this.socket;
      this.socket = null;
      try {
        dying.end(undefined as any);
      } catch {
        /* ignore */
      }
      this.status = { isConnected: false, isAuthenticated: false };
    }
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  isReady(): boolean {
    return this.status.isConnected && this.status.isAuthenticated;
  }

  // ========== MESSAGING ==========

  async sendText(
    to: string,
    text: string,
    _options?: SendMessageOptions
  ): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      const jid = this.normalizeToJid(to);
      const result = await this.socket.sendMessage(jid, { text });

      return {
        success: true,
        messageId: result?.key.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error('[Baileys] Send text error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendImage(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    return this.sendMedia(to, media, 'image', options);
  }

  async sendVideo(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    return this.sendMedia(to, media, 'video', options);
  }

  async sendAudio(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    return this.sendMedia(to, media, 'audio', options);
  }

  async sendDocument(
    to: string,
    media: MediaOptions,
    options?: SendMessageOptions
  ): Promise<MessageResult> {
    return this.sendMedia(to, media, 'document', options);
  }

  private async sendMedia(
    to: string,
    media: MediaOptions,
    type: 'image' | 'video' | 'audio' | 'document',
    _options?: SendMessageOptions
  ): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      const jid = this.normalizeToJid(to);
      let messageContent: any = {};

      const mediaBuffer = media.url
        ? { url: media.url }
        : Buffer.from(media.base64 || '', 'base64');

      switch (type) {
        case 'image':
          messageContent = { image: mediaBuffer, caption: media.caption };
          break;
        case 'video':
          messageContent = { video: mediaBuffer, caption: media.caption };
          break;
        case 'audio':
          messageContent = { audio: mediaBuffer, ptt: true };
          break;
        case 'document':
          messageContent = {
            document: mediaBuffer,
            fileName: media.filename,
            mimetype: media.mimetype,
          };
          break;
      }

      const result = await this.socket.sendMessage(jid, messageContent);

      return {
        success: true,
        messageId: result?.key.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error(`[Baileys] Send ${type} error:`, error);
      return { success: false, error: error.message };
    }
  }

  async sendLocation(
    to: string,
    location: LocationOptions,
    _options?: SendMessageOptions
  ): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      const jid = this.normalizeToJid(to);
      const result = await this.socket.sendMessage(jid, {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name,
          address: location.address,
        },
      });

      return {
        success: true,
        messageId: result?.key.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error('[Baileys] Send location error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendContact(
    to: string,
    contact: ContactOptions,
    _options?: SendMessageOptions
  ): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      const jid = this.normalizeToJid(to);
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL;type=CELL;type=VOICE;waid=${contact.phone}:+${contact.phone}\nEND:VCARD`;

      const result = await this.socket.sendMessage(jid, {
        contacts: {
          displayName: contact.name,
          contacts: [{ vcard }],
        },
      });

      return {
        success: true,
        messageId: result?.key.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error('[Baileys] Send contact error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendReaction(messageId: string, _emoji: string): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      // Baileys reaction requires the message key
      // This is a simplified version
      return { success: true, messageId };
    } catch (error: any) {
      console.error('[Baileys] Send reaction error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPoll(
    to: string,
    poll: PollOptions,
    _options?: SendMessageOptions
  ): Promise<MessageResult> {
    try {
      if (!this.isReady() || !this.socket) {
        return { success: false, error: 'Client not ready' };
      }

      const jid = this.normalizeToJid(to);
      const result = await this.socket.sendMessage(jid, {
        poll: {
          name: poll.question,
          values: poll.options,
          selectableCount: poll.allowMultipleAnswers ? poll.options.length : 1,
        },
      });

      return {
        success: true,
        messageId: result?.key.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error('[Baileys] Send poll error:', error);
      return { success: false, error: error.message };
    }
  }


  // ========== PRESENCE & CHAT STATE ==========

  async sendPresenceUpdate(to: string, state: 'composing' | 'available' | 'recording'): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) return;

      const jid = this.normalizeToJid(to);
      await this.socket.presenceSubscribe(jid);
      await this.socket.sendPresenceUpdate(state, jid);
      console.log(`[Baileys] Presence update: ${state} -> ${jid}`);
    } catch (error: any) {
      console.error('[Baileys] Send presence update error:', error);
      // Non-critical — don't throw
    }
  }

  async rejectCall(callId: string): Promise<void> {
    const from = this.callFrom.get(callId);
    if (this.socket && from) {
      await this.socket.rejectCall(callId, from);
    }
    this.callFrom.delete(callId);
  }

  async markAsRead(chatId: string, messageIds?: string[]): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) return;

      const jid = this.normalizeToJid(chatId);
      const keys = messageIds?.map(id => ({
        remoteJid: jid,
        id,
        fromMe: false,
      })) || [];

      if (keys.length > 0) {
        await this.socket.readMessages(keys);
      } else {
        // Mark entire chat as read by reading the latest message
        await this.socket.readMessages([{ remoteJid: jid, id: 'latest', fromMe: false }]);
      }
      console.log(`[Baileys] Marked as read: ${jid}, messages: ${messageIds?.length || 'all'}`);
    } catch (error: any) {
      console.error('[Baileys] Mark as read error:', error);
    }
  }

  async deleteForEveryone(chatId: string, messageId: string): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) return;

      const jid = this.normalizeToJid(chatId);
      const key = {
        remoteJid: jid,
        id: messageId,
        fromMe: true,
      };
      await this.socket.sendMessage(jid, { delete: key });
      console.log(`[Baileys] Deleted message ${messageId} for everyone in ${jid}`);
    } catch (error: any) {
      console.error('[Baileys] Delete for everyone error:', error);
      throw error;
    }
  }

  // ========== QR CODE ==========

  async getQRCode(): Promise<string | null> {
    return this.currentQR;
  }

  onQR(callback: (qr: string) => void): void {
    this.qrCallbacks.push(callback);
    if (this.currentQR) {
      callback(this.currentQR);
    }
  }

  // ========== SESSION ==========

  async getSessionData(): Promise<any> {
    return null; // Baileys uses file-based auth
  }

  async restoreSession(_data: any): Promise<boolean> {
    return true;
  }

  // ========== HELPERS ==========

  private normalizeToJid(phone: string): string {
    // If already a valid JID (contains @), return as-is
    // This preserves @g.us for groups and @s.whatsapp.net for individuals
    if (phone.includes('@')) {
      return phone;
    }
    
    // For regular phone numbers, strip non-digits and normalize
    let normalized = phone.replace(/\D/g, '');
    if (normalized.startsWith('0')) {
      normalized = '62' + normalized.slice(1);
    }
    return `${normalized}@s.whatsapp.net`;
  }

  // ========== GROUPS ==========

  async getGroups(): Promise<import('../types').GroupInfo[]> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      // Baileys uses groupFetchAllParticipating
      const groups = await this.socket.groupFetchAllParticipating();
      return Object.values(groups).map((g: any) => ({
        id: g.id,
        name: g.subject || '',
        description: g.desc || '',
        participants: (g.participants || []).map((p: any) => ({
          id: p.id,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
        owner: g.owner,
        createdAt: g.creation ? new Date(g.creation * 1000) : undefined,
      }));
    } catch (error: any) {
      console.error('[Baileys] Get groups error:', error);
      throw error;
    }
  }

  async getGroupInfo(groupId: string): Promise<import('../types').GroupInfo> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      const metadata = await this.socket.groupMetadata(groupId);
      return {
        id: metadata.id,
        name: metadata.subject || '',
        description: metadata.desc || '',
        participants: (metadata.participants || []).map((p: any) => ({
          id: p.id,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
        owner: metadata.owner,
        createdAt: metadata.creation ? new Date(metadata.creation * 1000) : undefined,
      };
    } catch (error: any) {
      console.error('[Baileys] Get group info error:', error);
      throw error;
    }
  }

  // ========== CONTACTS ==========

  // LID<->phone resolution is not implemented for this engine.
  async resolveIdentity(_jid: string): Promise<import('../types').ResolvedIdentity | null> {
    return null;
  }

  async getContacts(): Promise<import('../types').ContactInfo[]> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }

      // Baileys doesn't have a direct method to get all contacts
      // We use the store to get contacts from chat history
      const store = (this.socket as any).store;
      const contacts: import('../types').ContactInfo[] = [];

      if (store?.contacts) {
        // Get contacts from store
        for (const [jid, contact] of Object.entries(store.contacts)) {
          if (jid.endsWith('@s.whatsapp.net') && contact) {
            const c = contact as any;
            const phone = jid.replace('@s.whatsapp.net', '');
            contacts.push({
              id: jid,
              phone: phone,
              name: c.name || c.notify || phone,
              pushName: c.notify,
              isGroup: false,
              isMyContact: !!c.name, // Has name = is in contacts
            });
          }
        }
      }

      // If store is empty, try to get from chats
      if (contacts.length === 0) {
        const _chats = await this.socket.profilePictureUrl(this.status.phone + '@s.whatsapp.net', 'preview').catch(() => null);
        console.log('[Baileys] GetContacts: Store empty, contacts from chats not available yet');
      }

      console.log(`[Baileys] GetContacts: Found ${contacts.length} contacts`);
      return contacts;
    } catch (error: any) {
      console.error('[Baileys] Get contacts error:', error);
      throw error;
    }
  }

  async createGroup(name: string, participants: string[]): Promise<import('../types').GroupInfo> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      const group = await this.socket.groupCreate(name, participants);
      return {
        id: group.id,
        name: name,
        participants: participants.map(p => ({ id: p, isAdmin: false })),
      };
    } catch (error: any) {
      console.error('[Baileys] Create group error:', error);
      throw error;
    }
  }

  async setGroupName(groupId: string, name: string): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupUpdateSubject(groupId, name);
    } catch (error: any) {
      console.error('[Baileys] Set group name error:', error);
      throw error;
    }
  }

  async setGroupDescription(groupId: string, description: string): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupUpdateDescription(groupId, description);
    } catch (error: any) {
      console.error('[Baileys] Set group description error:', error);
      throw error;
    }
  }

  async addGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupParticipantsUpdate(groupId, participants, 'add');
    } catch (error: any) {
      console.error('[Baileys] Add group participants error:', error);
      throw error;
    }
  }

  async removeGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupParticipantsUpdate(groupId, participants, 'remove');
    } catch (error: any) {
      console.error('[Baileys] Remove group participants error:', error);
      throw error;
    }
  }

  async promoteGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupParticipantsUpdate(groupId, participants, 'promote');
    } catch (error: any) {
      console.error('[Baileys] Promote participants error:', error);
      throw error;
    }
  }

  async demoteGroupParticipants(groupId: string, participants: string[]): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupParticipantsUpdate(groupId, participants, 'demote');
    } catch (error: any) {
      console.error('[Baileys] Demote participants error:', error);
      throw error;
    }
  }

  async leaveGroup(groupId: string): Promise<void> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      await this.socket.groupLeave(groupId);
    } catch (error: any) {
      console.error('[Baileys] Leave group error:', error);
      throw error;
    }
  }

  async getGroupInviteLink(groupId: string): Promise<string> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      const code = await this.socket.groupInviteCode(groupId);
      return `https://chat.whatsapp.com/${code}`;
    } catch (error: any) {
      console.error('[Baileys] Get invite link error:', error);
      throw error;
    }
  }

  async revokeGroupInviteLink(groupId: string): Promise<string> {
    try {
      if (!this.isReady() || !this.socket) {
        throw new Error('Client not ready');
      }
      const code = await this.socket.groupRevokeInvite(groupId);
      return `https://chat.whatsapp.com/${code}`;
    } catch (error: any) {
      console.error('[Baileys] Revoke invite link error:', error);
      throw error;
    }
  }
}


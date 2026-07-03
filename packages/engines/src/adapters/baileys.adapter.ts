// MultiWA Gateway - Baileys Adapter (SECONDARY ENGINE)
// packages/engines/src/adapters/baileys.adapter.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WAMessageContent,
  proto,
  makeInMemoryStore,
  type WASocket,
} from '@whiskeysockets/baileys';
import type { Chat, Contact } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode-terminal';
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
  RecentChat,
  RecentChatMessage,
} from '../types';

/** Bound Baileys in-memory store for chat/message lookups during history sync. */
interface BaileysInMemoryStore {
  bind(ev: { on: (event: string, listener: (...args: unknown[]) => void) => void }): void;
  loadMessages(jid: string, limit: number): Promise<proto.IWebMessageInfo[]>;
  chats?: {
    all(): Array<{
      id?: string;
      jid?: string;
      conversationTimestamp?: number;
      name?: string;
    }>;
  };
  contacts?: Record<string, { name?: string; notify?: string; verifiedName?: string }>;
}

interface HistoryChatRow {
  jid: string;
  name: string;
  isGroup: boolean;
  sortTs: number;
}

/** File auth bundle from `useMultiFileAuthState`. */
interface BaileysAuthBundle {
  state: {
    creds: Parameters<typeof makeWASocket>[0]['auth']['creds'];
    keys: Parameters<typeof makeWASocket>[0]['auth']['keys'];
  };
  saveCreds: () => Promise<void>;
}

const BAILEYS_HISTORY_SYNC_WAIT_MS = 10_000;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

const baileysSilentLogger = {
  level: 'silent' as const,
  trace: (..._args: unknown[]) => undefined,
  debug: (..._args: unknown[]) => undefined,
  info: (..._args: unknown[]) => undefined,
  warn: (..._args: unknown[]) => undefined,
  error: (..._args: unknown[]) => undefined,
  child: () => baileysSilentLogger,
};


export class BaileysAdapter implements IWhatsAppEngine {
  readonly engineType = 'baileys' as const;

  private socket: WASocket | null = null;
  private config: EngineConfig | null = null;
  private status: EngineStatus = {
    isConnected: false,
    isAuthenticated: false,
  };
  private currentQR: string | null = null;
  private qrCallbacks: ((qr: string) => void)[] = [];
  private authState: BaileysAuthBundle | null = null;
  private connectionRetryCount: number = 0;
  private maxConnectionRetries: number = 3;
  // Single-authority reconnect state. Baileys owns its own reconnection internally so it never
  // competes with EngineManager's onDisconnected auto-retry (a double-reconnect spawns multiple
  // sockets, each emitting a fresh pairing QR every few seconds → impossible to scan).
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;
  private hasAuthenticated: boolean = false;
  private dataStore: BaileysInMemoryStore | null = null;
  private historyChats: Chat[] = [];
  private historyMessages: proto.IWebMessageInfo[] = [];
  private historyContacts: Record<string, Contact> = {};
  private historySetReceived = false;
  private historyWaiters = new Set<() => void>();

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
    this.resetHistorySyncState();

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
        dying.end(undefined);
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

    const keyLogger = baileysSilentLogger as unknown as Parameters<typeof makeCacheableSignalKeyStore>[1];
    const sock = makeWASocket({
      version,
      auth: {
        creds: this.authState.state.creds,
        keys: makeCacheableSignalKeyStore(
          this.authState.state.keys,
          keyLogger
        ),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
    });

    this.socket = sock;
    if (!this.dataStore) {
      this.dataStore = makeInMemoryStore({ logger: keyLogger }) as unknown as BaileysInMemoryStore;
    }
    this.dataStore.bind(sock.ev);
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
              const fs = require('fs');
              const path = require('path');
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

    // Initial WhatsApp history bundle. Baileys emits this after login; keep it
    // local so EngineManager can backfill conversations without firing live
    // message callbacks/webhooks.
    this.socket.ev.on('messaging-history.set', ({ chats, messages, contacts }) => {
      if (!isCurrent()) return;
      this.historyChats = chats || [];
      this.historyMessages = messages || [];
      this.historyContacts = this.normalizeHistoryContacts(contacts);
      this.historySetReceived = true;
      for (const resolve of this.historyWaiters) resolve();
      this.historyWaiters.clear();
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
    options?: SendMessageOptions
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
    options?: SendMessageOptions
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
    options?: SendMessageOptions
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
    options?: SendMessageOptions
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

  async sendReaction(messageId: string, emoji: string): Promise<MessageResult> {
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
    options?: SendMessageOptions
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

  async getRecentChats(chatLimit: number, perChatMessages: number): Promise<RecentChat[]> {
    if (!this.isReady()) return [];
    await this.waitForHistorySet();

    const rows = this.collectHistoryChatRows()
      .sort((a, b) => b.sortTs - a.sortTs)
      .slice(0, Math.max(1, chatLimit));

    return rows.map((chat) => {
      const messages = this.historyMessages
        .filter((message) => message.key?.remoteJid === chat.jid)
        .sort((a, b) => this.messageTimestampMs(b) - this.messageTimestampMs(a))
        .slice(0, Math.max(1, perChatMessages))
        .map((message) => this.toRecentChatMessage(message))
        .filter((message): message is RecentChatMessage => message !== null);

      return {
        jid: chat.jid,
        name: chat.name,
        isGroup: chat.isGroup,
        messages,
      };
    });
  }

  private resetHistorySyncState(): void {
    this.historyChats = [];
    this.historyMessages = [];
    this.historyContacts = {};
    this.historySetReceived = false;
    for (const resolve of this.historyWaiters) resolve();
    this.historyWaiters.clear();
  }

  private async waitForHistorySet(): Promise<void> {
    if (this.historySetReceived) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.historyWaiters.delete(done);
        resolve();
      }, BAILEYS_HISTORY_SYNC_WAIT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.historyWaiters.add(done);
    });
  }

  private collectHistoryChatRows(): HistoryChatRow[] {
    const rows = new Map<string, HistoryChatRow>();
    for (const chat of this.historyChats) {
      const jid = chat.id;
      if (!jid) continue;
      rows.set(jid, {
        jid,
        name: this.getHistoryChatName(jid, chat.name),
        isGroup: jid.endsWith('@g.us'),
        sortTs: this.timestampValue(chat.conversationTimestamp),
      });
    }
    for (const message of this.historyMessages) {
      const jid = message.key?.remoteJid;
      if (!jid || rows.has(jid)) continue;
      rows.set(jid, {
        jid,
        name: this.getHistoryChatName(jid),
        isGroup: jid.endsWith('@g.us'),
        sortTs: this.messageTimestampMs(message),
      });
    }
    return [...rows.values()];
  }

  private normalizeHistoryContacts(contacts: Contact[] | Record<string, Contact> | undefined): Record<string, Contact> {
    if (!contacts) return {};
    if (!Array.isArray(contacts)) return contacts;

    const normalized: Record<string, Contact> = {};
    for (const contact of contacts) {
      normalized[contact.id] = contact;
    }
    return normalized;
  }

  private getHistoryChatName(jid: string, fallback?: string | null): string {
    if (fallback?.trim()) return fallback.trim();
    const contact = this.historyContacts[jid];
    return contact?.name || contact?.notify || contact?.verifiedName || jid;
  }

  private toRecentChatMessage(message: proto.IWebMessageInfo): RecentChatMessage | null {
    const id = message.key?.id;
    const remoteJid = message.key?.remoteJid;
    if (!id || !remoteJid) return null;
    const content = message.message;
    return {
      id,
      fromMe: Boolean(message.key?.fromMe),
      from: remoteJid,
      author: message.key?.participant || undefined,
      body: this.getMessageBody(content),
      type: this.getMessageType(content),
      timestamp: this.messageTimestampMs(message),
      hasMedia: this.hasMediaContent(content),
    };
  }

  private getMessageBody(message: WAMessageContent | null | undefined): string {
    if (!message) return '';
    return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.videoMessage?.caption || '';
  }

  private hasMediaContent(message: WAMessageContent | null | undefined): boolean {
    return Boolean(message?.imageMessage || message?.videoMessage || message?.audioMessage || message?.documentMessage);
  }

  private messageTimestampMs(message: proto.IWebMessageInfo): number {
    return this.timestampValue(message.messageTimestamp);
  }

  private timestampValue(raw: unknown): number {
    if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? this.timestampValue(parsed) : Date.now();
    }
    if (raw && typeof raw === 'object' && 'toNumber' in raw && typeof raw.toNumber === 'function') {
      const parsed = raw.toNumber();
      return typeof parsed === 'number' ? this.timestampValue(parsed) : Date.now();
    }
    return Date.now();
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

  async restoreSession(data: any): Promise<boolean> {
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
        const chats = await this.socket.profilePictureUrl(this.status.phone + '@s.whatsapp.net', 'preview').catch(() => null);
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


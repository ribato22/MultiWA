// MultiWA Gateway - Baileys Adapter (SECONDARY ENGINE)
// packages/engines/src/adapters/baileys.adapter.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WAMessageContent,
  proto,
} from '@whiskeysockets/baileys';
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
  private authState: any = null;
  private connectionRetryCount: number = 0;
  private maxConnectionRetries: number = 3;

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

    const { version } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] Using WA version ${version.join('.')}`);

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

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection update
    this.socket.ev.on('connection.update', async (update) => {
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
        const isConnectionFailure = lastDisconnect?.error?.message?.includes('Connection Failure');

        console.log(
          `[Baileys] Connection closed for profile ${this.config?.profileId}. StatusCode: ${statusCode}, Retry count: ${this.connectionRetryCount}`
        );

        this.status = { isConnected: false, isAuthenticated: false };

        // Check if session might be stale (multiple connection failures)
        if (isConnectionFailure) {
          this.connectionRetryCount++;
          
          if (this.connectionRetryCount >= this.maxConnectionRetries) {
            console.log(`[Baileys] Max retries (${this.maxConnectionRetries}) reached for profile ${this.config?.profileId}. Clearing stale session...`);
            
            // Clear session folder to force fresh QR code
            const sessionDir = this.config?.sessionDir || `./sessions/${this.config?.profileId}`;
            try {
              const fs = require('fs');
              const path = require('path');
              const files = fs.readdirSync(sessionDir);
              for (const file of files) {
                fs.unlinkSync(path.join(sessionDir, file));
              }
              console.log(`[Baileys] Session cleared for profile ${this.config?.profileId}. Will generate new QR code.`);
            } catch (err: any) {
              console.error(`[Baileys] Failed to clear session: ${err.message}`);
            }
            
            this.connectionRetryCount = 0;
            // Notify disconnect - user needs to reconnect with fresh QR
            this.config?.onDisconnected?.('Session expired. Please reconnect.');
            return;
          }
        } else {
          // Reset retry count on different error types
          this.connectionRetryCount = 0;
        }

        this.config?.onDisconnected?.(
          lastDisconnect?.error?.message || 'Connection closed'
        );

        // Auto-reconnect unless logged out
        if (!isLoggedOut) {
          const delay = Math.min(3000 * (this.connectionRetryCount + 1), 15000); // Exponential backoff, max 15s
          console.log(`[Baileys] Reconnecting in ${delay}ms...`);
          setTimeout(() => this.connect(), delay);
        }
      }

      if (connection === 'open') {
        console.log(`[Baileys] Connected for profile ${this.config?.profileId}`);
        this.connectionRetryCount = 0; // Reset retry counter on successful connection
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
    if (this.socket) {
      await this.socket.logout();
      this.status = { isConnected: false, isAuthenticated: false };
    }
  }

  async destroy(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
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


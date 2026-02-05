"use strict";
// MultiWA Gateway - Baileys Adapter (SECONDARY ENGINE)
// packages/engines/src/adapters/baileys.adapter.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaileysAdapter = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const qrcode = __importStar(require("qrcode-terminal"));
class BaileysAdapter {
    engineType = 'baileys';
    socket = null;
    config = null;
    status = {
        isConnected: false,
        isAuthenticated: false,
    };
    currentQR = null;
    qrCallbacks = [];
    authState = null;
    connectionRetryCount = 0;
    maxConnectionRetries = 3;
    async initialize(config) {
        this.config = config;
        const sessionDir = config.sessionDir || `./sessions/${config.profileId}`;
        // Load auth state
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionDir);
        this.authState = { state, saveCreds };
    }
    async connect() {
        if (!this.authState) {
            throw new Error('Not initialized. Call initialize() first.');
        }
        const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
        console.log(`[Baileys] Using WA version ${version.join('.')}`);
        this.socket = (0, baileys_1.default)({
            version,
            auth: {
                creds: this.authState.state.creds,
                keys: (0, baileys_1.makeCacheableSignalKeyStore)(this.authState.state.keys, console),
            },
            printQRInTerminal: false,
            generateHighQualityLinkPreview: true,
        });
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        if (!this.socket)
            return;
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
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === baileys_1.DisconnectReason.loggedOut;
                const isConnectionFailure = lastDisconnect?.error?.message?.includes('Connection Failure');
                console.log(`[Baileys] Connection closed for profile ${this.config?.profileId}. StatusCode: ${statusCode}, Retry count: ${this.connectionRetryCount}`);
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
                        }
                        catch (err) {
                            console.error(`[Baileys] Failed to clear session: ${err.message}`);
                        }
                        this.connectionRetryCount = 0;
                        // Notify disconnect - user needs to reconnect with fresh QR
                        this.config?.onDisconnected?.('Session expired. Please reconnect.');
                        return;
                    }
                }
                else {
                    // Reset retry count on different error types
                    this.connectionRetryCount = 0;
                }
                this.config?.onDisconnected?.(lastDisconnect?.error?.message || 'Connection closed');
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
                this.config?.onReady?.(this.socket?.user?.id?.split(':')[0] || '', this.socket?.user?.name || '');
            }
        });
        // Credentials update
        this.socket.ev.on('creds.update', this.authState.saveCreds);
        // Messages
        this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify')
                return;
            for (const message of messages) {
                if (message.key.fromMe)
                    continue;
                const transformedMessage = {
                    id: message.key.id,
                    from: message.key.remoteJid,
                    to: this.socket?.user?.id,
                    body: message.message?.conversation ||
                        message.message?.extendedTextMessage?.text || '',
                    type: this.getMessageType(message.message),
                    timestamp: new Date(message.messageTimestamp * 1000),
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
                    const statusMap = {
                        1: 'pending',
                        2: 'sent',
                        3: 'delivered',
                        4: 'read',
                    };
                    this.config?.onMessageAck?.(update.key.id || '', statusMap[update.update.status] || 'unknown');
                }
            }
        });
    }
    getMessageType(message) {
        if (!message)
            return 'unknown';
        if (message.conversation || message.extendedTextMessage)
            return 'text';
        if (message.imageMessage)
            return 'image';
        if (message.videoMessage)
            return 'video';
        if (message.audioMessage)
            return 'audio';
        if (message.documentMessage)
            return 'document';
        if (message.locationMessage)
            return 'location';
        if (message.contactMessage)
            return 'contact';
        if (message.stickerMessage)
            return 'sticker';
        return 'unknown';
    }
    async disconnect() {
        if (this.socket) {
            await this.socket.logout();
            this.status = { isConnected: false, isAuthenticated: false };
        }
    }
    async destroy() {
        if (this.socket) {
            this.socket.end(undefined);
            this.socket = null;
            this.status = { isConnected: false, isAuthenticated: false };
        }
    }
    getStatus() {
        return { ...this.status };
    }
    isReady() {
        return this.status.isConnected && this.status.isAuthenticated;
    }
    // ========== MESSAGING ==========
    async sendText(to, text, options) {
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
        }
        catch (error) {
            console.error('[Baileys] Send text error:', error);
            return { success: false, error: error.message };
        }
    }
    async sendImage(to, media, options) {
        return this.sendMedia(to, media, 'image', options);
    }
    async sendVideo(to, media, options) {
        return this.sendMedia(to, media, 'video', options);
    }
    async sendAudio(to, media, options) {
        return this.sendMedia(to, media, 'audio', options);
    }
    async sendDocument(to, media, options) {
        return this.sendMedia(to, media, 'document', options);
    }
    async sendMedia(to, media, type, options) {
        try {
            if (!this.isReady() || !this.socket) {
                return { success: false, error: 'Client not ready' };
            }
            const jid = this.normalizeToJid(to);
            let messageContent = {};
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
        }
        catch (error) {
            console.error(`[Baileys] Send ${type} error:`, error);
            return { success: false, error: error.message };
        }
    }
    async sendLocation(to, location, options) {
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
        }
        catch (error) {
            console.error('[Baileys] Send location error:', error);
            return { success: false, error: error.message };
        }
    }
    async sendContact(to, contact, options) {
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
        }
        catch (error) {
            console.error('[Baileys] Send contact error:', error);
            return { success: false, error: error.message };
        }
    }
    async sendReaction(messageId, emoji) {
        try {
            if (!this.isReady() || !this.socket) {
                return { success: false, error: 'Client not ready' };
            }
            // Baileys reaction requires the message key
            // This is a simplified version
            return { success: true, messageId };
        }
        catch (error) {
            console.error('[Baileys] Send reaction error:', error);
            return { success: false, error: error.message };
        }
    }
    async sendPoll(to, poll, options) {
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
        }
        catch (error) {
            console.error('[Baileys] Send poll error:', error);
            return { success: false, error: error.message };
        }
    }
    // ========== QR CODE ==========
    async getQRCode() {
        return this.currentQR;
    }
    onQR(callback) {
        this.qrCallbacks.push(callback);
        if (this.currentQR) {
            callback(this.currentQR);
        }
    }
    // ========== SESSION ==========
    async getSessionData() {
        return null; // Baileys uses file-based auth
    }
    async restoreSession(data) {
        return true;
    }
    // ========== HELPERS ==========
    normalizeToJid(phone) {
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
    async getGroups() {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            // Baileys uses groupFetchAllParticipating
            const groups = await this.socket.groupFetchAllParticipating();
            return Object.values(groups).map((g) => ({
                id: g.id,
                name: g.subject || '',
                description: g.desc || '',
                participants: (g.participants || []).map((p) => ({
                    id: p.id,
                    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                    isSuperAdmin: p.admin === 'superadmin',
                })),
                owner: g.owner,
                createdAt: g.creation ? new Date(g.creation * 1000) : undefined,
            }));
        }
        catch (error) {
            console.error('[Baileys] Get groups error:', error);
            throw error;
        }
    }
    async getGroupInfo(groupId) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            const metadata = await this.socket.groupMetadata(groupId);
            return {
                id: metadata.id,
                name: metadata.subject || '',
                description: metadata.desc || '',
                participants: (metadata.participants || []).map((p) => ({
                    id: p.id,
                    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                    isSuperAdmin: p.admin === 'superadmin',
                })),
                owner: metadata.owner,
                createdAt: metadata.creation ? new Date(metadata.creation * 1000) : undefined,
            };
        }
        catch (error) {
            console.error('[Baileys] Get group info error:', error);
            throw error;
        }
    }
    // ========== CONTACTS ==========
    async getContacts() {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            // Baileys doesn't have a direct method to get all contacts
            // We use the store to get contacts from chat history
            const store = this.socket.store;
            const contacts = [];
            if (store?.contacts) {
                // Get contacts from store
                for (const [jid, contact] of Object.entries(store.contacts)) {
                    if (jid.endsWith('@s.whatsapp.net') && contact) {
                        const c = contact;
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
        }
        catch (error) {
            console.error('[Baileys] Get contacts error:', error);
            throw error;
        }
    }
    async createGroup(name, participants) {
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
        }
        catch (error) {
            console.error('[Baileys] Create group error:', error);
            throw error;
        }
    }
    async setGroupName(groupId, name) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupUpdateSubject(groupId, name);
        }
        catch (error) {
            console.error('[Baileys] Set group name error:', error);
            throw error;
        }
    }
    async setGroupDescription(groupId, description) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupUpdateDescription(groupId, description);
        }
        catch (error) {
            console.error('[Baileys] Set group description error:', error);
            throw error;
        }
    }
    async addGroupParticipants(groupId, participants) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupParticipantsUpdate(groupId, participants, 'add');
        }
        catch (error) {
            console.error('[Baileys] Add group participants error:', error);
            throw error;
        }
    }
    async removeGroupParticipants(groupId, participants) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupParticipantsUpdate(groupId, participants, 'remove');
        }
        catch (error) {
            console.error('[Baileys] Remove group participants error:', error);
            throw error;
        }
    }
    async promoteGroupParticipants(groupId, participants) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupParticipantsUpdate(groupId, participants, 'promote');
        }
        catch (error) {
            console.error('[Baileys] Promote participants error:', error);
            throw error;
        }
    }
    async demoteGroupParticipants(groupId, participants) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupParticipantsUpdate(groupId, participants, 'demote');
        }
        catch (error) {
            console.error('[Baileys] Demote participants error:', error);
            throw error;
        }
    }
    async leaveGroup(groupId) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            await this.socket.groupLeave(groupId);
        }
        catch (error) {
            console.error('[Baileys] Leave group error:', error);
            throw error;
        }
    }
    async getGroupInviteLink(groupId) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            const code = await this.socket.groupInviteCode(groupId);
            return `https://chat.whatsapp.com/${code}`;
        }
        catch (error) {
            console.error('[Baileys] Get invite link error:', error);
            throw error;
        }
    }
    async revokeGroupInviteLink(groupId) {
        try {
            if (!this.isReady() || !this.socket) {
                throw new Error('Client not ready');
            }
            const code = await this.socket.groupRevokeInvite(groupId);
            return `https://chat.whatsapp.com/${code}`;
        }
        catch (error) {
            console.error('[Baileys] Revoke invite link error:', error);
            throw error;
        }
    }
}
exports.BaileysAdapter = BaileysAdapter;
//# sourceMappingURL=baileys.adapter.js.map
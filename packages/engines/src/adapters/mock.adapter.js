"use strict";
// MultiWA Gateway - Mock Adapter (TESTING)
// packages/engines/src/adapters/mock.adapter.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAdapter = void 0;
/**
 * Mock adapter for testing and development
 * Simulates WhatsApp behavior without actual connection
 */
class MockAdapter {
    engineType = 'mock';
    config = null;
    status = {
        isConnected: false,
        isAuthenticated: false,
    };
    qrCallbacks = [];
    messageCounter = 0;
    async initialize(config) {
        this.config = config;
        console.log(`[Mock] Initialized for profile ${config.profileId}`);
    }
    async connect() {
        console.log(`[Mock] Connecting profile ${this.config?.profileId}...`);
        // Simulate QR code generation
        setTimeout(() => {
            const mockQR = `mock-qr-${Date.now()}`;
            this.qrCallbacks.forEach((cb) => cb(mockQR));
            this.config?.onQR?.(mockQR);
        }, 500);
        // Simulate successful connection after 2 seconds
        setTimeout(() => {
            this.status = {
                isConnected: true,
                isAuthenticated: true,
                phone: '6281234567890',
                pushName: 'Mock User',
                lastConnectedAt: new Date(),
            };
            this.config?.onReady?.('6281234567890', 'Mock User');
        }, 2000);
    }
    async disconnect() {
        this.status = { isConnected: false, isAuthenticated: false };
        this.config?.onDisconnected?.('Manual disconnect');
        console.log(`[Mock] Disconnected profile ${this.config?.profileId}`);
    }
    async destroy() {
        await this.disconnect();
        console.log(`[Mock] Destroyed profile ${this.config?.profileId}`);
    }
    getStatus() {
        return { ...this.status };
    }
    isReady() {
        return this.status.isConnected && this.status.isAuthenticated;
    }
    // ========== MESSAGING ==========
    async sendText(to, text, options) {
        console.log(`[Mock] Sending text to ${to}: ${text.substring(0, 50)}...`);
        return this.mockSend('text');
    }
    async sendImage(to, media, options) {
        console.log(`[Mock] Sending image to ${to}`);
        return this.mockSend('image');
    }
    async sendVideo(to, media, options) {
        console.log(`[Mock] Sending video to ${to}`);
        return this.mockSend('video');
    }
    async sendAudio(to, media, options) {
        console.log(`[Mock] Sending audio to ${to}`);
        return this.mockSend('audio');
    }
    async sendDocument(to, media, options) {
        console.log(`[Mock] Sending document to ${to}`);
        return this.mockSend('document');
    }
    async sendLocation(to, location, options) {
        console.log(`[Mock] Sending location to ${to}: ${location.latitude}, ${location.longitude}`);
        return this.mockSend('location');
    }
    async sendContact(to, contact, options) {
        console.log(`[Mock] Sending contact to ${to}: ${contact.name}`);
        return this.mockSend('contact');
    }
    async sendReaction(messageId, emoji) {
        console.log(`[Mock] Sending reaction ${emoji} to ${messageId}`);
        return { success: true, messageId };
    }
    async sendPoll(to, poll, options) {
        console.log(`[Mock] Sending poll to ${to}: ${poll.question} (${poll.options.length} options)`);
        return this.mockSend('poll');
    }
    mockSend(type) {
        if (!this.isReady()) {
            return { success: false, error: 'Client not ready' };
        }
        this.messageCounter++;
        const messageId = `mock_${type}_${Date.now()}_${this.messageCounter}`;
        // Simulate async ACK updates
        setTimeout(() => {
            this.config?.onMessageAck?.(messageId, 'sent');
        }, 100);
        setTimeout(() => {
            this.config?.onMessageAck?.(messageId, 'delivered');
        }, 500);
        setTimeout(() => {
            this.config?.onMessageAck?.(messageId, 'read');
        }, 1000);
        return {
            success: true,
            messageId,
            timestamp: new Date(),
        };
    }
    // ========== QR CODE ==========
    async getQRCode() {
        return `mock-qr-${Date.now()}`;
    }
    onQR(callback) {
        this.qrCallbacks.push(callback);
    }
    // ========== SESSION ==========
    async getSessionData() {
        return { mock: true, profileId: this.config?.profileId };
    }
    async restoreSession(data) {
        console.log(`[Mock] Restoring session for profile ${this.config?.profileId}`);
        return true;
    }
    // ========== SIMULATION HELPERS ==========
    /**
     * Simulate receiving a message (for testing)
     */
    simulateIncomingMessage(from, body) {
        const message = {
            id: `mock_incoming_${Date.now()}`,
            from: from.includes('@') ? from : `${from}@s.whatsapp.net`,
            to: this.status.phone,
            body,
            type: 'text',
            timestamp: new Date(),
            isGroup: from.includes('@g.us'),
            hasMedia: false,
            fromMe: false,
        };
        this.config?.onMessage?.(message);
    }
    // ========== GROUPS (MOCK STUBS) ==========
    async getGroups() {
        console.log(`[Mock] Getting groups`);
        return [
            { id: 'mock-group-1@g.us', name: 'Mock Group 1', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: true }] },
            { id: 'mock-group-2@g.us', name: 'Mock Group 2', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: false }] },
        ];
    }
    async getGroupInfo(groupId) {
        console.log(`[Mock] Getting group info: ${groupId}`);
        return { id: groupId, name: 'Mock Group', participants: [{ id: '628xxx@s.whatsapp.net', isAdmin: true }] };
    }
    // ========== CONTACTS (MOCK STUBS) ==========
    async getContacts() {
        console.log(`[Mock] Getting contacts`);
        return [
            { id: '6281234567890@s.whatsapp.net', phone: '6281234567890', name: 'Mock Contact 1', isGroup: false },
            { id: '6289876543210@s.whatsapp.net', phone: '6289876543210', name: 'Mock Contact 2', pushName: 'MockUser', isGroup: false },
        ];
    }
    async createGroup(name, participants) {
        console.log(`[Mock] Creating group: ${name} with ${participants.length} participants`);
        return { id: `mock-group-${Date.now()}@g.us`, name, participants: participants.map(p => ({ id: p, isAdmin: false })) };
    }
    async setGroupName(groupId, name) {
        console.log(`[Mock] Setting group name: ${groupId} -> ${name}`);
    }
    async setGroupDescription(groupId, description) {
        console.log(`[Mock] Setting group description: ${groupId} -> ${description.substring(0, 50)}...`);
    }
    async addGroupParticipants(groupId, participants) {
        console.log(`[Mock] Adding participants to ${groupId}: ${participants.join(', ')}`);
    }
    async removeGroupParticipants(groupId, participants) {
        console.log(`[Mock] Removing participants from ${groupId}: ${participants.join(', ')}`);
    }
    async promoteGroupParticipants(groupId, participants) {
        console.log(`[Mock] Promoting participants in ${groupId}: ${participants.join(', ')}`);
    }
    async demoteGroupParticipants(groupId, participants) {
        console.log(`[Mock] Demoting participants in ${groupId}: ${participants.join(', ')}`);
    }
    async leaveGroup(groupId) {
        console.log(`[Mock] Leaving group: ${groupId}`);
    }
    async getGroupInviteLink(groupId) {
        console.log(`[Mock] Getting invite link for: ${groupId}`);
        return `https://chat.whatsapp.com/mock-invite-${Date.now()}`;
    }
    async revokeGroupInviteLink(groupId) {
        console.log(`[Mock] Revoking invite link for: ${groupId}`);
        return `https://chat.whatsapp.com/mock-new-invite-${Date.now()}`;
    }
}
exports.MockAdapter = MockAdapter;
//# sourceMappingURL=mock.adapter.js.map
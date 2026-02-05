"use strict";
// MultiWA Gateway SDK - Messages Client
// packages/sdk/src/clients/messages.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageClient = void 0;
class MessageClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Send a text message
     */
    async sendText(options) {
        return this.client.post('/messages/text', options);
    }
    /**
     * Send an image message
     */
    async sendImage(options) {
        return this.client.post('/messages/image', options);
    }
    /**
     * Send a video message
     */
    async sendVideo(options) {
        return this.client.post('/messages/video', options);
    }
    /**
     * Send an audio message (including voice notes)
     */
    async sendAudio(options) {
        return this.client.post('/messages/audio', options);
    }
    /**
     * Send a document
     */
    async sendDocument(options) {
        return this.client.post('/messages/document', options);
    }
    /**
     * Send a location
     */
    async sendLocation(options) {
        return this.client.post('/messages/location', options);
    }
    /**
     * Send contact cards (vCard)
     */
    async sendContact(options) {
        return this.client.post('/messages/contact', options);
    }
    /**
     * Send a reaction to a message
     */
    async sendReaction(options) {
        return this.client.post('/messages/reaction', options);
    }
    /**
     * Reply to a message
     */
    async sendReply(options) {
        return this.client.post('/messages/reply', options);
    }
    /**
     * Get message history for a conversation
     */
    async list(conversationId, options) {
        return this.client.get(`/conversations/${conversationId}/messages`, options);
    }
    /**
     * Get a specific message by ID
     */
    async get(id) {
        return this.client.get(`/messages/${id}`);
    }
}
exports.MessageClient = MessageClient;
//# sourceMappingURL=messages.js.map
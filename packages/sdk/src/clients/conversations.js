"use strict";
// MultiWA Gateway SDK - Conversations Client
// packages/sdk/src/clients/conversations.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationClient = void 0;
class ConversationClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * List conversations
     */
    async list(profileId, options) {
        return this.client.get('/conversations', { profileId, ...options });
    }
    /**
     * Get a conversation by ID
     */
    async get(id) {
        return this.client.get(`/conversations/${id}`);
    }
    /**
     * Get messages in a conversation
     */
    async getMessages(id, options) {
        return this.client.get(`/conversations/${id}/messages`, options);
    }
    /**
     * Archive a conversation
     */
    async archive(id) {
        return this.client.post(`/conversations/${id}/archive`);
    }
    /**
     * Unarchive a conversation
     */
    async unarchive(id) {
        return this.client.post(`/conversations/${id}/unarchive`);
    }
    /**
     * Mark conversation as read
     */
    async markAsRead(id) {
        return this.client.post(`/conversations/${id}/read`);
    }
}
exports.ConversationClient = ConversationClient;
//# sourceMappingURL=conversations.js.map
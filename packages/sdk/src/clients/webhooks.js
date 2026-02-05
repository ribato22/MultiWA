"use strict";
// MultiWA Gateway SDK - Webhooks Client
// packages/sdk/src/clients/webhooks.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookClient = void 0;
class WebhookClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new webhook
     */
    async create(options) {
        return this.client.post('/webhooks', options);
    }
    /**
     * List webhooks
     */
    async list(profileId) {
        return this.client.get('/webhooks', { profileId });
    }
    /**
     * Get a webhook by ID
     */
    async get(id) {
        return this.client.get(`/webhooks/${id}`);
    }
    /**
     * Update a webhook
     */
    async update(id, data) {
        return this.client.put(`/webhooks/${id}`, data);
    }
    /**
     * Delete a webhook
     */
    async delete(id) {
        return this.client.delete(`/webhooks/${id}`);
    }
    /**
     * Test webhook delivery
     */
    async test(id) {
        return this.client.post(`/webhooks/${id}/test`);
    }
    /**
     * Get webhook delivery logs
     */
    async getLogs(id, options) {
        return this.client.get(`/webhooks/${id}/logs`, options);
    }
}
exports.WebhookClient = WebhookClient;
//# sourceMappingURL=webhooks.js.map
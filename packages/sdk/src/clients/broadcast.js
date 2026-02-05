"use strict";
// MultiWA Gateway SDK - Broadcast Client
// packages/sdk/src/clients/broadcast.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.BroadcastClient = void 0;
class BroadcastClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new broadcast
     */
    async create(options) {
        return this.client.post('/broadcast', options);
    }
    /**
     * List broadcasts
     */
    async list(profileId, options) {
        return this.client.get('/broadcast', { profileId, ...options });
    }
    /**
     * Get a broadcast by ID
     */
    async get(id) {
        return this.client.get(`/broadcast/${id}`);
    }
    /**
     * Update a broadcast (draft only)
     */
    async update(id, data) {
        return this.client.put(`/broadcast/${id}`, data);
    }
    /**
     * Delete a broadcast
     */
    async delete(id) {
        return this.client.delete(`/broadcast/${id}`);
    }
    /**
     * Schedule a broadcast
     */
    async schedule(id, scheduledAt) {
        return this.client.post(`/broadcast/${id}/schedule`, {
            scheduledAt: typeof scheduledAt === 'string' ? scheduledAt : scheduledAt.toISOString()
        });
    }
    /**
     * Start broadcast immediately
     */
    async start(id) {
        return this.client.post(`/broadcast/${id}/start`);
    }
    /**
     * Pause a running broadcast
     */
    async pause(id) {
        return this.client.post(`/broadcast/${id}/pause`);
    }
    /**
     * Resume a paused broadcast
     */
    async resume(id) {
        return this.client.post(`/broadcast/${id}/resume`);
    }
    /**
     * Cancel a broadcast
     */
    async cancel(id) {
        return this.client.post(`/broadcast/${id}/cancel`);
    }
    /**
     * Get broadcast statistics
     */
    async getStats(id) {
        return this.client.get(`/broadcast/${id}/stats`);
    }
    /**
     * Get broadcast recipients
     */
    async getRecipients(id, options) {
        return this.client.get(`/broadcast/${id}/recipients`, options);
    }
}
exports.BroadcastClient = BroadcastClient;
//# sourceMappingURL=broadcast.js.map
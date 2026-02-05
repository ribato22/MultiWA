"use strict";
// MultiWA Gateway SDK - Automation Client
// packages/sdk/src/clients/automation.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationClient = void 0;
class AutomationClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new automation
     */
    async create(options) {
        return this.client.post('/automation', options);
    }
    /**
     * List automations
     */
    async list(profileId, options) {
        return this.client.get('/automation', { profileId, ...options });
    }
    /**
     * Get an automation by ID
     */
    async get(id) {
        return this.client.get(`/automation/${id}`);
    }
    /**
     * Update an automation
     */
    async update(id, data) {
        return this.client.put(`/automation/${id}`, data);
    }
    /**
     * Delete an automation
     */
    async delete(id) {
        return this.client.delete(`/automation/${id}`);
    }
    /**
     * Toggle automation on/off
     */
    async toggle(id) {
        return this.client.put(`/automation/${id}/toggle`);
    }
    /**
     * Test automation with sample message
     */
    async test(id, message) {
        return this.client.post(`/automation/${id}/test`, { message });
    }
    /**
     * Get automation statistics
     */
    async getStats(id) {
        return this.client.get(`/automation/${id}/stats`);
    }
    /**
     * Reorder automation priorities
     */
    async reorder(profileId, order) {
        return this.client.post('/automation/reorder', { profileId, order });
    }
}
exports.AutomationClient = AutomationClient;
//# sourceMappingURL=automation.js.map
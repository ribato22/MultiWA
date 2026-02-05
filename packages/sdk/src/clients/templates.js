"use strict";
// MultiWA Gateway SDK - Templates Client
// packages/sdk/src/clients/templates.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateClient = void 0;
class TemplateClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new template
     */
    async create(options) {
        return this.client.post('/templates', options);
    }
    /**
     * List templates
     */
    async list(profileId, options) {
        return this.client.get('/templates', { profileId, ...options });
    }
    /**
     * Get a template by ID
     */
    async get(id) {
        return this.client.get(`/templates/${id}`);
    }
    /**
     * Update a template
     */
    async update(id, data) {
        return this.client.put(`/templates/${id}`, data);
    }
    /**
     * Delete a template
     */
    async delete(id) {
        return this.client.delete(`/templates/${id}`);
    }
    /**
     * Preview template with variables
     */
    async preview(id, variables) {
        return this.client.post(`/templates/${id}/preview`, { variables });
    }
    /**
     * Duplicate a template
     */
    async duplicate(id, newName) {
        return this.client.post(`/templates/${id}/duplicate`, { name: newName });
    }
}
exports.TemplateClient = TemplateClient;
//# sourceMappingURL=templates.js.map
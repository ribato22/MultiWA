"use strict";
// MultiWA Gateway SDK - Contacts Client
// packages/sdk/src/clients/contacts.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactClient = void 0;
class ContactClient {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * Create a new contact
     */
    async create(options) {
        return this.client.post('/contacts', options);
    }
    /**
     * List contacts with filtering
     */
    async list(profileId, options) {
        return this.client.get('/contacts', { profileId, ...options });
    }
    /**
     * Get a contact by ID
     */
    async get(id) {
        return this.client.get(`/contacts/${id}`);
    }
    /**
     * Update a contact
     */
    async update(id, data) {
        return this.client.put(`/contacts/${id}`, data);
    }
    /**
     * Delete a contact
     */
    async delete(id) {
        return this.client.delete(`/contacts/${id}`);
    }
    /**
     * Bulk import contacts from JSON array
     */
    async import(options) {
        return this.client.post('/contacts/import', options);
    }
    /**
     * Import contacts from CSV data
     */
    async importCsv(options) {
        return this.client.post('/contacts/import/csv', options);
    }
    /**
     * Export contacts to CSV
     */
    async exportCsv(profileId, options) {
        return this.client.get('/contacts/export/csv', { profileId, ...options });
    }
    /**
     * Add tags to a contact
     */
    async addTags(id, tags) {
        return this.client.post(`/contacts/${id}/tags`, { tags });
    }
    /**
     * Remove tags from a contact
     */
    async removeTags(id, tags) {
        return this.client.delete(`/contacts/${id}/tags`, { tags });
    }
    /**
     * Validate a phone number
     */
    async validatePhone(profileId, phone) {
        return this.client.get(`/contacts/profile/${profileId}/validate/${phone}`);
    }
    /**
     * Bulk validate phone numbers
     */
    async validateBulk(profileId, phones) {
        return this.client.post(`/contacts/profile/${profileId}/validate`, { phones });
    }
}
exports.ContactClient = ContactClient;
//# sourceMappingURL=contacts.js.map
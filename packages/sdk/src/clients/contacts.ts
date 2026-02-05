// MultiWA Gateway SDK - Contacts Client
// packages/sdk/src/clients/contacts.ts

import type { MultiWAClient } from '../client';
import type {
  Contact,
  CreateContactOptions,
  UpdateContactOptions,
  ImportContactsOptions,
  ImportCsvOptions,
  PaginatedResponse,
} from '../types';

export class ContactClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Create a new contact
   */
  async create(options: CreateContactOptions): Promise<Contact> {
    return this.client.post('/contacts', options);
  }

  /**
   * List contacts with filtering
   */
  async list(profileId: string, options?: {
    search?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Contact>> {
    return this.client.get('/contacts', { profileId, ...options });
  }

  /**
   * Get a contact by ID
   */
  async get(id: string): Promise<Contact> {
    return this.client.get(`/contacts/${id}`);
  }

  /**
   * Update a contact
   */
  async update(id: string, data: UpdateContactOptions): Promise<Contact> {
    return this.client.put(`/contacts/${id}`, data);
  }

  /**
   * Delete a contact
   */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete(`/contacts/${id}`);
  }

  /**
   * Bulk import contacts from JSON array
   */
  async import(options: ImportContactsOptions): Promise<{
    created: number;
    updated: number;
    failed: number;
    errors: string[];
  }> {
    return this.client.post('/contacts/import', options);
  }

  /**
   * Import contacts from CSV data
   */
  async importCsv(options: ImportCsvOptions): Promise<{
    created: number;
    updated: number;
    failed: number;
    errors: string[];
  }> {
    return this.client.post('/contacts/import/csv', options);
  }

  /**
   * Export contacts to CSV
   */
  async exportCsv(profileId: string, options?: { tags?: string[] }): Promise<{
    csv: string;
    count: number;
    filename: string;
  }> {
    return this.client.get('/contacts/export/csv', { profileId, ...options });
  }

  /**
   * Add tags to a contact
   */
  async addTags(id: string, tags: string[]): Promise<Contact> {
    return this.client.post(`/contacts/${id}/tags`, { tags });
  }

  /**
   * Remove tags from a contact
   */
  async removeTags(id: string, tags: string[]): Promise<Contact> {
    return this.client.delete(`/contacts/${id}/tags`, { tags });
  }

  /**
   * Validate a phone number
   */
  async validatePhone(profileId: string, phone: string): Promise<{
    phone: string;
    validFormat: boolean;
    isIndonesian: boolean;
    onWhatsApp: boolean | null;
  }> {
    return this.client.get(`/contacts/profile/${profileId}/validate/${phone}`);
  }

  /**
   * Bulk validate phone numbers
   */
  async validateBulk(profileId: string, phones: string[]): Promise<{
    total: number;
    valid: number;
    results: any[];
  }> {
    return this.client.post(`/contacts/profile/${profileId}/validate`, { phones });
  }
}

// MultiWA Gateway SDK - Templates Client
// packages/sdk/src/clients/templates.ts

import type { MultiWAClient } from '../client';
import type { Template, CreateTemplateOptions, PaginatedResponse } from '../types';

export class TemplateClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Create a new template
   */
  async create(options: CreateTemplateOptions): Promise<Template> {
    return this.client.post('/templates', options);
  }

  /**
   * List templates
   */
  async list(profileId: string, options?: {
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Template>> {
    return this.client.get('/templates', { profileId, ...options });
  }

  /**
   * Get a template by ID
   */
  async get(id: string): Promise<Template> {
    return this.client.get(`/templates/${id}`);
  }

  /**
   * Update a template
   */
  async update(id: string, data: Partial<CreateTemplateOptions>): Promise<Template> {
    return this.client.put(`/templates/${id}`, data);
  }

  /**
   * Delete a template
   */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete(`/templates/${id}`);
  }

  /**
   * Preview template with variables
   */
  async preview(id: string, variables: Record<string, string>): Promise<{
    rendered: any;
    variables: string[];
  }> {
    return this.client.post(`/templates/${id}/preview`, { variables });
  }

  /**
   * Duplicate a template
   */
  async duplicate(id: string, newName: string): Promise<Template> {
    return this.client.post(`/templates/${id}/duplicate`, { name: newName });
  }
}

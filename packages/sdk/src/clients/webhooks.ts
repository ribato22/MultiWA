// MultiWA Gateway SDK - Webhooks Client
// packages/sdk/src/clients/webhooks.ts

import type { MultiWAClient } from '../client';
import type { Webhook, CreateWebhookOptions, PaginatedResponse } from '../types';

export class WebhookClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Create a new webhook
   */
  async create(options: CreateWebhookOptions): Promise<Webhook> {
    return this.client.post('/webhooks', options);
  }

  /**
   * List webhooks
   */
  async list(profileId: string): Promise<Webhook[]> {
    return this.client.get('/webhooks', { profileId });
  }

  /**
   * Get a webhook by ID
   */
  async get(id: string): Promise<Webhook> {
    return this.client.get(`/webhooks/${id}`);
  }

  /**
   * Update a webhook
   */
  async update(id: string, data: Partial<CreateWebhookOptions>): Promise<Webhook> {
    return this.client.put(`/webhooks/${id}`, data);
  }

  /**
   * Delete a webhook
   */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete(`/webhooks/${id}`);
  }

  /**
   * Test webhook delivery
   */
  async test(id: string): Promise<{
    success: boolean;
    statusCode: number;
    responseTime: number;
  }> {
    return this.client.post(`/webhooks/${id}/test`);
  }

  /**
   * Get webhook delivery logs
   */
  async getLogs(id: string, options?: {
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<{
    id: string;
    event: string;
    payload: any;
    statusCode: number;
    success: boolean;
    createdAt: Date;
  }>> {
    return this.client.get(`/webhooks/${id}/logs`, options);
  }
}

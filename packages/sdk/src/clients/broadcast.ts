// MultiWA Gateway SDK - Broadcast Client
// packages/sdk/src/clients/broadcast.ts

import type { MultiWAClient } from '../client';
import type { Broadcast, CreateBroadcastOptions, BroadcastStats, PaginatedResponse } from '../types';

export class BroadcastClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Create a new broadcast
   */
  async create(options: CreateBroadcastOptions): Promise<Broadcast> {
    return this.client.post('/broadcast', options);
  }

  /**
   * List broadcasts
   */
  async list(profileId: string, options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Broadcast>> {
    return this.client.get('/broadcast', { profileId, ...options });
  }

  /**
   * Get a broadcast by ID
   */
  async get(id: string): Promise<Broadcast> {
    return this.client.get(`/broadcast/${id}`);
  }

  /**
   * Update a broadcast (draft only)
   */
  async update(id: string, data: Partial<CreateBroadcastOptions>): Promise<Broadcast> {
    return this.client.put(`/broadcast/${id}`, data);
  }

  /**
   * Delete a broadcast
   */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete(`/broadcast/${id}`);
  }

  /**
   * Schedule a broadcast
   */
  async schedule(id: string, scheduledAt: Date | string): Promise<Broadcast> {
    return this.client.post(`/broadcast/${id}/schedule`, { 
      scheduledAt: typeof scheduledAt === 'string' ? scheduledAt : scheduledAt.toISOString()
    });
  }

  /**
   * Start broadcast immediately
   */
  async start(id: string): Promise<{ success: boolean; recipientCount: number }> {
    return this.client.post(`/broadcast/${id}/start`);
  }

  /**
   * Pause a running broadcast
   */
  async pause(id: string): Promise<Broadcast> {
    return this.client.post(`/broadcast/${id}/pause`);
  }

  /**
   * Resume a paused broadcast
   */
  async resume(id: string): Promise<{ success: boolean }> {
    return this.client.post(`/broadcast/${id}/resume`);
  }

  /**
   * Cancel a broadcast
   */
  async cancel(id: string): Promise<Broadcast> {
    return this.client.post(`/broadcast/${id}/cancel`);
  }

  /**
   * Get broadcast statistics
   */
  async getStats(id: string): Promise<BroadcastStats & {
    successRate: number;
    progress: number;
    duration: number | null;
  }> {
    return this.client.get(`/broadcast/${id}/stats`);
  }

  /**
   * Get broadcast recipients
   */
  async getRecipients(id: string, options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<any>> {
    return this.client.get(`/broadcast/${id}/recipients`, options);
  }
}

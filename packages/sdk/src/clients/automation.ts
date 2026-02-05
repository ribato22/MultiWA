// MultiWA Gateway SDK - Automation Client
// packages/sdk/src/clients/automation.ts

import type { MultiWAClient } from '../client';
import type { Automation, CreateAutomationOptions, PaginatedResponse } from '../types';

export class AutomationClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Create a new automation
   */
  async create(options: CreateAutomationOptions): Promise<Automation> {
    return this.client.post('/automation', options);
  }

  /**
   * List automations
   */
  async list(profileId: string, options?: {
    triggerType?: string;
    isActive?: boolean;
  }): Promise<Automation[]> {
    return this.client.get('/automation', { profileId, ...options });
  }

  /**
   * Get an automation by ID
   */
  async get(id: string): Promise<Automation> {
    return this.client.get(`/automation/${id}`);
  }

  /**
   * Update an automation
   */
  async update(id: string, data: Partial<CreateAutomationOptions>): Promise<Automation> {
    return this.client.put(`/automation/${id}`, data);
  }

  /**
   * Delete an automation
   */
  async delete(id: string): Promise<{ success: boolean }> {
    return this.client.delete(`/automation/${id}`);
  }

  /**
   * Toggle automation on/off
   */
  async toggle(id: string): Promise<Automation> {
    return this.client.put(`/automation/${id}/toggle`);
  }

  /**
   * Test automation with sample message
   */
  async test(id: string, message: string): Promise<{
    matches: boolean;
    matchDetails: any;
    actions: any[] | null;
  }> {
    return this.client.post(`/automation/${id}/test`, { message });
  }

  /**
   * Get automation statistics
   */
  async getStats(id: string): Promise<{
    triggerCount: number;
    lastTriggered: Date | null;
    todayCount: number;
  }> {
    return this.client.get(`/automation/${id}/stats`);
  }

  /**
   * Reorder automation priorities
   */
  async reorder(profileId: string, order: string[]): Promise<{ success: boolean }> {
    return this.client.post('/automation/reorder', { profileId, order });
  }
}

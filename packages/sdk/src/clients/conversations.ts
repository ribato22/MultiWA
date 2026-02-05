// MultiWA Gateway SDK - Conversations Client
// packages/sdk/src/clients/conversations.ts

import type { MultiWAClient } from '../client';
import type { Conversation, Message, PaginatedResponse } from '../types';

export class ConversationClient {
  constructor(private client: MultiWAClient) {}

  /**
   * List conversations
   */
  async list(profileId: string, options?: {
    search?: string;
    type?: string;
    archived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Conversation>> {
    return this.client.get('/conversations', { profileId, ...options });
  }

  /**
   * Get a conversation by ID
   */
  async get(id: string): Promise<Conversation> {
    return this.client.get(`/conversations/${id}`);
  }

  /**
   * Get messages in a conversation
   */
  async getMessages(id: string, options?: {
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Message>> {
    return this.client.get(`/conversations/${id}/messages`, options);
  }

  /**
   * Archive a conversation
   */
  async archive(id: string): Promise<Conversation> {
    return this.client.post(`/conversations/${id}/archive`);
  }

  /**
   * Unarchive a conversation
   */
  async unarchive(id: string): Promise<Conversation> {
    return this.client.post(`/conversations/${id}/unarchive`);
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(id: string): Promise<Conversation> {
    return this.client.post(`/conversations/${id}/read`);
  }
}

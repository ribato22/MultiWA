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
    await this.client.put(`/conversations/${id}/archive`);
    return readBack(this.client, id);
  }

  /**
   * Unarchive a conversation
   */
  async unarchive(id: string): Promise<Conversation> {
    await this.client.put(`/conversations/${id}/unarchive`);
    return readBack(this.client, id);
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(id: string): Promise<Conversation> {
    await this.client.put(`/conversations/${id}/read`);
    return readBack(this.client, id);
  }
}

// The archive, unarchive and read routes answer `{ success: true }`, not the
// conversation, so read it back to keep returning a `Conversation`. That GET
// embeds the latest messages (inline media included); 1 is the smallest page.
function readBack(client: MultiWAClient, id: string): Promise<Conversation> {
  return client.get(`/conversations/${id}`, { messageLimit: 1 });
}

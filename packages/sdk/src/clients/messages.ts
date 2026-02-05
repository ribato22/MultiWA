// MultiWA Gateway SDK - Messages Client
// packages/sdk/src/clients/messages.ts

import type { MultiWAClient } from '../client';
import type {
  Message,
  SendTextOptions,
  SendMediaOptions,
  SendLocationOptions,
  SendContactOptions,
  SendReactionOptions,
  SendReplyOptions,
  PaginatedResponse,
} from '../types';

export class MessageClient {
  constructor(private client: MultiWAClient) {}

  /**
   * Send a text message
   */
  async sendText(options: SendTextOptions): Promise<Message> {
    return this.client.post('/messages/text', options);
  }

  /**
   * Send an image message
   */
  async sendImage(options: SendMediaOptions): Promise<Message> {
    return this.client.post('/messages/image', options);
  }

  /**
   * Send a video message
   */
  async sendVideo(options: SendMediaOptions): Promise<Message> {
    return this.client.post('/messages/video', options);
  }

  /**
   * Send an audio message (including voice notes)
   */
  async sendAudio(options: SendMediaOptions & { ptt?: boolean }): Promise<Message> {
    return this.client.post('/messages/audio', options);
  }

  /**
   * Send a document
   */
  async sendDocument(options: SendMediaOptions): Promise<Message> {
    return this.client.post('/messages/document', options);
  }

  /**
   * Send a location
   */
  async sendLocation(options: SendLocationOptions): Promise<Message> {
    return this.client.post('/messages/location', options);
  }

  /**
   * Send contact cards (vCard)
   */
  async sendContact(options: SendContactOptions): Promise<Message> {
    return this.client.post('/messages/contact', options);
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(options: SendReactionOptions): Promise<Message> {
    return this.client.post('/messages/reaction', options);
  }

  /**
   * Reply to a message
   */
  async sendReply(options: SendReplyOptions): Promise<Message> {
    return this.client.post('/messages/reply', options);
  }

  /**
   * Get message history for a conversation
   */
  async list(conversationId: string, options?: {
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<Message>> {
    return this.client.get(`/conversations/${conversationId}/messages`, options);
  }

  /**
   * Get a specific message by ID
   */
  async get(id: string): Promise<Message> {
    return this.client.get(`/messages/${id}`);
  }
}

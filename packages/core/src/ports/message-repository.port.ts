// MultiWA Gateway Core - Message Repository Port
// packages/core/src/ports/message-repository.port.ts

import type { Message } from '../entities/message.entity';

export interface MessageQueryOptions {
  limit?: number;
  offset?: number;
  direction?: 'incoming' | 'outgoing';
  startDate?: Date;
  endDate?: Date;
}

export interface IMessageRepository {
  findById(id: string): Promise<Message | null>;
  findByConversationId(conversationId: string, options?: MessageQueryOptions): Promise<Message[]>;
  findByProfileId(profileId: string, options?: MessageQueryOptions): Promise<Message[]>;
  create(message: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  updateStatus(id: string, status: Message['status']): Promise<void>;
  delete(id: string): Promise<void>;
}

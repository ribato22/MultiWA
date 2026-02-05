// MultiWA Gateway Core - Message Entity
// packages/core/src/entities/message.entity.ts

export type MessageType = 
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contact'
  | 'sticker'
  | 'poll'
  | 'reaction';

export type MessageStatus = 
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageDirection = 'incoming' | 'outgoing';

export interface TextContent {
  body: string;
}

export interface MediaContent {
  url?: string;
  base64?: string;
  mimetype: string;
  filename?: string;
  caption?: string;
}

export interface LocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactContent {
  name: string;
  phone: string;
}

export type MessageContent = 
  | { type: 'text'; text: TextContent }
  | { type: 'image' | 'video' | 'audio' | 'document' | 'sticker'; media: MediaContent }
  | { type: 'location'; location: LocationContent }
  | { type: 'contact'; contact: ContactContent };

export interface Message {
  id: string;
  profileId: string;
  conversationId: string;
  messageId: string; // WhatsApp message ID
  direction: MessageDirection;
  senderJid: string;
  type: MessageType;
  content: MessageContent;
  quotedMessageId?: string;
  status: MessageStatus;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface SendMessageInput {
  profileId: string;
  to: string;
  content: MessageContent;
  quotedMessageId?: string;
}

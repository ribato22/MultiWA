// MultiWA Gateway Core - Contact Entity
// packages/core/src/entities/contact.entity.ts

export interface Contact {
  id: string;
  profileId: string;
  phone: string;
  name?: string;
  whatsappName?: string;
  avatarUrl?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  isBlocked: boolean;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  profileId: string;
  phone: string;
  name?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

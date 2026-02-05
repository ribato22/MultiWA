// MultiWA Gateway Core - Profile Entity
// packages/core/src/entities/profile.entity.ts

export type EngineType = 'whatsapp-web-js' | 'baileys' | 'mock';

export type ProfileStatus = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'qr_ready'
  | 'authenticated'
  | 'failed';

export interface ProfileSettings {
  webhookUrl?: string;
  webhookSecret?: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
}

export interface Profile {
  id: string;
  workspaceId: string;
  name: string;
  phone?: string;
  engine: EngineType;
  status: ProfileStatus;
  sessionData?: Record<string, unknown>;
  settings: ProfileSettings;
  lastConnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProfileInput {
  workspaceId: string;
  name: string;
  engine: EngineType;
  settings?: ProfileSettings;
}

export interface UpdateProfileInput {
  name?: string;
  engine?: EngineType;
  settings?: Partial<ProfileSettings>;
}

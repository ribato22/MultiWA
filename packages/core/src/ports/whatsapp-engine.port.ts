// MultiWA Gateway Core - WhatsApp Engine Port
// packages/core/src/ports/whatsapp-engine.port.ts

// Types imported as needed in implementations

export interface EngineConfig {
  profileId: string;
  sessionData?: Record<string, unknown>;
  authDir?: string;
  puppeteerOptions?: Record<string, unknown>;
}

export interface EngineStatus {
  isConnected: boolean;
  isAuthenticated: boolean;
  phone?: string;
  pushName?: string;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export type EngineEvent = 
  | 'qr'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'message'
  | 'message_ack'
  | 'message_revoke'
  | 'group_update';

export type EngineEventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * WhatsApp Engine Port - Hexagonal Architecture
 * 
 * This interface defines the contract that all WhatsApp engine adapters
 * (whatsapp-web.js, Baileys, etc.) must implement.
 */
export interface IWhatsAppEngine {
  // Engine type identifier
  readonly engineType: string;

  // Lifecycle
  initialize(config: EngineConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
  
  // Authentication
  getQRCode(): AsyncGenerator<string>;
  isAuthenticated(): boolean;
  getStatus(): EngineStatus;
  
  // Messaging
  sendText(to: string, text: string): Promise<MessageResult>;
  sendMedia(to: string, media: {
    type: 'image' | 'video' | 'audio' | 'document';
    url?: string;
    base64?: string;
    filename?: string;
    caption?: string;
  }): Promise<MessageResult>;
  sendLocation(to: string, location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  }): Promise<MessageResult>;
  sendContact(to: string, contact: {
    name: string;
    phone: string;
  }): Promise<MessageResult>;
  sendReaction(messageId: string, emoji: string): Promise<MessageResult>;

  // Events
  on<T = unknown>(event: EngineEvent, handler: EngineEventHandler<T>): void;
  off<T = unknown>(event: EngineEvent, handler: EngineEventHandler<T>): void;
  
  // Session management
  getSessionData(): Promise<Record<string, unknown> | null>;
  restoreSession(sessionData: Record<string, unknown>): Promise<boolean>;
}

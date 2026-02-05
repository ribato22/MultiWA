// MultiWA Gateway - Engine Types
// packages/engines/src/types.ts

export type EngineType = 'whatsapp-web-js' | 'baileys' | 'mock';

export interface EngineConfig {
  profileId: string;
  sessionDir?: string;
  puppeteerOptions?: {
    headless?: boolean;
    executablePath?: string;
    args?: string[];
  };
  onQR?: (qr: string) => void;
  onReady?: (phone: string, pushName: string) => void;
  onDisconnected?: (reason: string) => void;
  onMessage?: (message: any) => void;
  onMessageAck?: (messageId: string, status: string) => void;
}

export interface SendMessageOptions {
  quotedMessageId?: string;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp?: Date;
}

export interface EngineStatus {
  isConnected: boolean;
  isAuthenticated: boolean;
  phone?: string;
  pushName?: string;
  lastConnectedAt?: Date;
}

export interface MediaOptions {
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
}

export interface LocationOptions {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactOptions {
  name: string;
  phone: string;
}

export interface PollOptions {
  question: string;
  options: string[];
  allowMultipleAnswers?: boolean;
}

export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  description?: string;
  participants: GroupParticipant[];
  participantCount?: number;
  owner?: string;
  createdAt?: Date;
  isAdmin?: boolean;
}

export interface ContactInfo {
  id: string;           // WhatsApp JID
  phone: string;        // Phone number
  name: string;         // Contact name (as saved in WhatsApp)
  pushName?: string;    // WhatsApp push name (user-set name)
  profilePicUrl?: string;
  isGroup?: boolean;
  isMyContact?: boolean;
}

/**
 * Base interface for WhatsApp engines
 * All engine adapters must implement this interface
 */
export interface IWhatsAppEngine {
  readonly engineType: EngineType;
  
  // Lifecycle
  initialize(config: EngineConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
  
  // Status
  getStatus(): EngineStatus;
  isReady(): boolean;
  
  // Messaging
  sendText(to: string, text: string, options?: SendMessageOptions): Promise<MessageResult>;
  sendImage(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendVideo(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendAudio(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendDocument(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendLocation(to: string, location: LocationOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendContact(to: string, contact: ContactOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendReaction(messageId: string, emoji: string): Promise<MessageResult>;
  sendPoll(to: string, poll: PollOptions, options?: SendMessageOptions): Promise<MessageResult>;

  // Presence & Chat State
  sendPresenceUpdate(to: string, state: 'composing' | 'available' | 'recording'): Promise<void>;
  
  // Read Receipts
  markAsRead(chatId: string, messageIds?: string[]): Promise<void>;
  
  // Message management
  deleteForEveryone(chatId: string, messageId: string): Promise<void>;

  // QR Code
  getQRCode(): Promise<string | null>;
  onQR(callback: (qr: string) => void): void;
  
  // Session
  getSessionData(): Promise<any>;
  restoreSession(data: any): Promise<boolean>;

  // Groups
  getGroups(): Promise<GroupInfo[]>;
  getGroupInfo(groupId: string): Promise<GroupInfo>;

  // Contacts - fetch contacts from WhatsApp
  getContacts(): Promise<ContactInfo[]>;

  createGroup(name: string, participants: string[]): Promise<GroupInfo>;
  setGroupName(groupId: string, name: string): Promise<void>;
  setGroupDescription(groupId: string, description: string): Promise<void>;
  addGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  removeGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  promoteGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  demoteGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  leaveGroup(groupId: string): Promise<void>;
  getGroupInviteLink(groupId: string): Promise<string>;
  revokeGroupInviteLink(groupId: string): Promise<string>;
}


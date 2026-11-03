// MultiWA Gateway SDK - Type Definitions
// packages/sdk/src/types.ts

// ============================================
// Common Types
// ============================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================
// Message Types
// ============================================

export type MessageType = 
  | 'text' 
  | 'image' 
  | 'video' 
  | 'audio' 
  | 'document' 
  | 'location' 
  | 'contact' 
  | 'reaction';

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  id: string;
  profileId: string;
  conversationId: string;
  messageId: string;
  direction: MessageDirection;
  senderJid: string;
  type: MessageType;
  content: any;
  status: MessageStatus;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface SendTextOptions {
  profileId: string;
  to: string;
  text: string;
}

export interface SendMediaOptions {
  profileId: string;
  to: string;
  url?: string;
  base64?: string;
  caption?: string;
  filename?: string;
}

export interface SendLocationOptions {
  profileId: string;
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface SendContactOptions {
  profileId: string;
  to: string;
  contacts: VCardContact[];
}

export interface VCardContact {
  name: string;
  phone: string;
  organization?: string;
}

export interface SendReactionOptions {
  profileId: string;
  messageId: string;
  emoji: string;
}

export interface SendReplyOptions {
  profileId: string;
  to: string;
  quotedMessageId: string;
  text: string;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  profileId: string;
  phone: string;
  name?: string;
  whatsappName?: string;
  tags: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactOptions {
  profileId: string;
  phone: string;
  name?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface UpdateContactOptions {
  name?: string;
  phone?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ImportContactsOptions {
  profileId: string;
  contacts: { phone: string; name?: string; tags?: string[] }[];
}

export interface ImportCsvOptions {
  profileId: string;
  csvData: string;
}

// ============================================
// Conversation Types
// ============================================

export interface Conversation {
  id: string;
  profileId: string;
  jid: string;
  name?: string;
  type: 'user' | 'group' | 'broadcast';
  unreadCount: number;
  lastMessageAt?: Date;
  createdAt: Date;
}

// ============================================
// Template Types
// ============================================

export interface Template {
  id: string;
  profileId: string;
  name: string;
  category?: string;
  messageType: string;
  content: any;
  variables: string[];
  usageCount: number;
  createdAt: Date;
}

export interface CreateTemplateOptions {
  profileId: string;
  name: string;
  category?: string;
  messageType?: string;
  content: any;
}

export interface PreviewTemplateOptions {
  variables: Record<string, string>;
}

// ============================================
// Broadcast Types
// ============================================

export type BroadcastStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';

export interface Broadcast {
  id: string;
  profileId: string;
  name: string;
  message: any;
  recipients: BroadcastRecipients;
  status: BroadcastStatus;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  stats: BroadcastStats;
  createdAt: Date;
}

export interface BroadcastRecipients {
  type: 'tags' | 'contacts' | 'all';
  value: string[];
}

export interface BroadcastStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export interface CreateBroadcastOptions {
  profileId: string;
  name: string;
  message: any;
  recipients: BroadcastRecipients;
  settings?: {
    delayMin?: number;
    delayMax?: number;
    batchSize?: number;
    retryFailed?: boolean;
    retryAttempts?: number;
  };
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  id: string;
  profileId: string;
  url: string;
  events: string[];
  secret: string;
  enabled: boolean;
  createdAt: Date;
}

export interface CreateWebhookOptions {
  profileId: string;
  url: string;
  events: string[];
  secret?: string;
  headers?: Record<string, string>;
}

// ============================================
// Automation Types
// ============================================

export type TriggerType = 'keyword' | 'regex' | 'new_contact' | 'message_type' | 'all';

export interface Automation {
  id: string;
  profileId: string;
  name: string;
  isActive: boolean;
  priority: number;
  triggerType: TriggerType;
  triggerConfig: any;
  conditions: any[];
  actions: any[];
  cooldownSecs: number;
  maxTriggersPerDay?: number;
  stats: any;
  createdAt: Date;
}

export interface CreateAutomationOptions {
  profileId: string;
  name: string;
  triggerType: TriggerType;
  triggerConfig: any;
  conditions?: any[];
  actions: any[];
  cooldownSecs?: number;
  maxTriggersPerDay?: number;
}

// ============================================
// Call Types
// ============================================

export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'rejected' | 'answered_elsewhere' | 'unknown';
export type CallFollowUp = 'open' | 'in_progress' | 'done';
export type CallEndReason = 'hangup' | 'caller_hangup' | 'agent_lost' | 'media_failed' | 'time_limit' | 'server_restart';

/** A call's recording: its facts. The audio is `calls.getRecording()`. */
export interface CallRecording {
  id: string;
  durationSec: number;
  bytes: number;
  /** It may end before its call did: a restart, a recorder that did not stop cleanly, or a write that failed. */
  partial: boolean;
  announcementPlayed: boolean;
  createdAt: string;
  /** Set once its file is deleted: the row stays as evidence. */
  deletedAt: string | null;
  /** `admin` or `retention`. */
  deleteReason: string | null;
}

/** An incoming WhatsApp call. Dates are ISO 8601 strings. */
export interface Call {
  id: string;
  profileId: string;
  waCallId: string;
  fromJid: string;
  isVideo: boolean;
  isGroup: boolean;
  direction: string;
  outcome: CallOutcome;
  rejectedBy: 'auto' | 'agent' | 'device' | null;
  startedAt: string;
  endedAt: string | null;
  followUp: CallFollowUp;
  assignedUserId: string | null;
  /** The agent who answered it in the dashboard, once `outcome` is `answered`. */
  answeredByUserId: string | null;
  answeredAt: string | null;
  endedBy: 'agent' | 'caller' | 'server' | null;
  endReason: CallEndReason | null;
  /** Seconds the agent and the caller talked; null when not known. */
  talkSeconds: number | null;
  autoReplySentAt: string | null;
  conversationId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  assignedUser: { id: string; name: string } | null;
  answeredBy: { id: string; name: string } | null;
  conversation: { id: string; name: string | null } | null;
  recording: CallRecording | null;
}

export interface CallList {
  calls: Call[];
  /** Pass it as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface ListCallsOptions {
  outcome?: CallOutcome;
  followUp?: CallFollowUp;
  /** The caller: a phone number (`628111000111`) or a JID. */
  from?: string;
  /** Calls that started at or after it: a Date, sent in ISO 8601 (UTC), or an ISO 8601 string. */
  since?: Date | string;
  /** 1 to 100 (default 50). */
  limit?: number;
  cursor?: string;
}

export interface UpdateCallOptions {
  followUp?: CallFollowUp;
  /** An active user of the organization, or null to unassign. */
  assignedUserId?: string | null;
}

/** The message a call action sent to the caller. */
export interface CallMessage {
  success: boolean;
  messageId: string;
  conversationId: string;
  /** `sent`, or `queued` with DURABLE_SEND or ENGINE_HOST=worker. */
  status: string;
  waMessageId?: string;
}

/** The call and the message sent: an `open` follow-up is now `in_progress`, any other is left as it was. */
export interface CallReplyResult {
  call: Call;
  message: CallMessage;
}

/** The call, the message sent and the link: an `open` follow-up is now `in_progress`, any other is left as it was. */
export interface CallLinkResult extends CallReplyResult {
  link: string;
}

export interface CallAnnouncement {
  /** `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm` or `audio/mp4`, read from the file. */
  mimeType: string;
  durationSec: number;
}

export interface CallsSettings {
  profileId: string;
  answerInDashboard: boolean;
  recording: boolean;
  retentionDays: number;
  announcement: CallAnnouncement | null;
}

export interface UpdateCallsSettingsOptions {
  answerInDashboard?: boolean;
  recording?: boolean;
  /** 1 to 3650. An API key with a scope list needs `recordings:delete` for it too. */
  retentionDays?: number;
}

/** `GET /calls/media/status` (owner or admin). */
export interface CallsMediaStatus {
  server: {
    enabled: boolean;
    worker: 'up' | 'down';
    port: number | null;
    engineHost: 'api' | 'worker';
    activeSessions: number;
    recordings: {
      storage: 'local' | 's3';
      configured: boolean;
      problem: string | null;
      lastCheck: { at: string; ok: boolean; reason?: string } | null;
    };
  };
  profiles: Array<CallsSettings & { name: string; ready: boolean; reasons: string[] }>;
}

export interface DeletedCallRecording {
  callId: string;
  recordingId: string;
  deletedAt: string;
}

export interface CallAnnouncementResult {
  profileId: string;
  /** Null once removed. */
  announcement: CallAnnouncement | null;
}

/** Bytes the API answered with, and their Content-Type. */
export interface BinaryResponse {
  data: Uint8Array;
  contentType: string;
}

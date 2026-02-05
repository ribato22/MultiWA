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
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact' | 'reaction';
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
    contacts: {
        phone: string;
        name?: string;
        tags?: string[];
    }[];
}
export interface ImportCsvOptions {
    profileId: string;
    csvData: string;
}
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
//# sourceMappingURL=types.d.ts.map
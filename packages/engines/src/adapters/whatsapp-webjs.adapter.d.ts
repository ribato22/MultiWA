import type { IWhatsAppEngine, EngineConfig, EngineStatus, MessageResult, MediaOptions, LocationOptions, ContactOptions, PollOptions, SendMessageOptions } from '../types';
export declare class WhatsAppWebJsAdapter implements IWhatsAppEngine {
    readonly engineType: "whatsapp-web-js";
    private client;
    private config;
    private status;
    private currentQR;
    private qrCallbacks;
    initialize(config: EngineConfig): Promise<void>;
    private setupEventHandlers;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    destroy(): Promise<void>;
    getStatus(): EngineStatus;
    isReady(): boolean;
    sendText(to: string, text: string, options?: SendMessageOptions): Promise<MessageResult>;
    sendImage(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendVideo(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendAudio(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendDocument(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
    private sendMedia;
    sendLocation(to: string, location: LocationOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendContact(to: string, contact: ContactOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendReaction(messageId: string, emoji: string): Promise<MessageResult>;
    sendPoll(to: string, poll: PollOptions, options?: SendMessageOptions): Promise<MessageResult>;
    /**
     * Send presence update (typing indicator) to a chat.
     * @param to - The JID of the chat
     * @param state - 'composing' to show typing, 'available' to clear it
     */
    sendPresenceUpdate(to: string, state: 'composing' | 'available' | 'recording'): Promise<void>;
    /**
     * Mark a chat or specific messages as read.
     */
    markAsRead(chatId: string, messageIds?: string[]): Promise<void>;
    /**
     * Delete a message for everyone in the chat.
     */
    deleteForEveryone(chatId: string, messageId: string): Promise<void>;
    getQRCode(): Promise<string | null>;
    onQR(callback: (qr: string) => void): void;
    getSessionData(): Promise<any>;
    restoreSession(data: any): Promise<boolean>;
    private normalizePhoneToJid;
    getGroups(): Promise<import('../types').GroupInfo[]>;
    getGroupInfo(groupId: string): Promise<import('../types').GroupInfo>;
    getContacts(): Promise<import('../types').ContactInfo[]>;
    createGroup(name: string, participants: string[]): Promise<import('../types').GroupInfo>;
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

import type { IWhatsAppEngine, EngineConfig, EngineStatus, MessageResult, MediaOptions, LocationOptions, ContactOptions, PollOptions, SendMessageOptions } from '../types';
/**
 * Mock adapter for testing and development
 * Simulates WhatsApp behavior without actual connection
 */
export declare class MockAdapter implements IWhatsAppEngine {
    readonly engineType: "mock";
    private config;
    private status;
    private qrCallbacks;
    private messageCounter;
    initialize(config: EngineConfig): Promise<void>;
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
    sendLocation(to: string, location: LocationOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendContact(to: string, contact: ContactOptions, options?: SendMessageOptions): Promise<MessageResult>;
    sendReaction(messageId: string, emoji: string): Promise<MessageResult>;
    sendPoll(to: string, poll: PollOptions, options?: SendMessageOptions): Promise<MessageResult>;
    private mockSend;
    getQRCode(): Promise<string | null>;
    onQR(callback: (qr: string) => void): void;
    getSessionData(): Promise<any>;
    restoreSession(data: any): Promise<boolean>;
    /**
     * Simulate receiving a message (for testing)
     */
    simulateIncomingMessage(from: string, body: string): void;
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
//# sourceMappingURL=mock.adapter.d.ts.map
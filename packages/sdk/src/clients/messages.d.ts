import type { MultiWAClient } from '../client';
import type { Message, SendTextOptions, SendMediaOptions, SendLocationOptions, SendContactOptions, SendReactionOptions, SendReplyOptions, PaginatedResponse } from '../types';
export declare class MessageClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Send a text message
     */
    sendText(options: SendTextOptions): Promise<Message>;
    /**
     * Send an image message
     */
    sendImage(options: SendMediaOptions): Promise<Message>;
    /**
     * Send a video message
     */
    sendVideo(options: SendMediaOptions): Promise<Message>;
    /**
     * Send an audio message (including voice notes)
     */
    sendAudio(options: SendMediaOptions & {
        ptt?: boolean;
    }): Promise<Message>;
    /**
     * Send a document
     */
    sendDocument(options: SendMediaOptions): Promise<Message>;
    /**
     * Send a location
     */
    sendLocation(options: SendLocationOptions): Promise<Message>;
    /**
     * Send contact cards (vCard)
     */
    sendContact(options: SendContactOptions): Promise<Message>;
    /**
     * Send a reaction to a message
     */
    sendReaction(options: SendReactionOptions): Promise<Message>;
    /**
     * Reply to a message
     */
    sendReply(options: SendReplyOptions): Promise<Message>;
    /**
     * Get message history for a conversation
     */
    list(conversationId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Message>>;
    /**
     * Get a specific message by ID
     */
    get(id: string): Promise<Message>;
}
//# sourceMappingURL=messages.d.ts.map
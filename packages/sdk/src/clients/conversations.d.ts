import type { MultiWAClient } from '../client';
import type { Conversation, Message, PaginatedResponse } from '../types';
export declare class ConversationClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * List conversations
     */
    list(profileId: string, options?: {
        search?: string;
        type?: string;
        archived?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Conversation>>;
    /**
     * Get a conversation by ID
     */
    get(id: string): Promise<Conversation>;
    /**
     * Get messages in a conversation
     */
    getMessages(id: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Message>>;
    /**
     * Archive a conversation
     */
    archive(id: string): Promise<Conversation>;
    /**
     * Unarchive a conversation
     */
    unarchive(id: string): Promise<Conversation>;
    /**
     * Mark conversation as read
     */
    markAsRead(id: string): Promise<Conversation>;
}
//# sourceMappingURL=conversations.d.ts.map
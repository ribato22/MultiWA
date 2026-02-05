import type { MultiWAClient } from '../client';
import type { Broadcast, CreateBroadcastOptions, BroadcastStats, PaginatedResponse } from '../types';
export declare class BroadcastClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Create a new broadcast
     */
    create(options: CreateBroadcastOptions): Promise<Broadcast>;
    /**
     * List broadcasts
     */
    list(profileId: string, options?: {
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Broadcast>>;
    /**
     * Get a broadcast by ID
     */
    get(id: string): Promise<Broadcast>;
    /**
     * Update a broadcast (draft only)
     */
    update(id: string, data: Partial<CreateBroadcastOptions>): Promise<Broadcast>;
    /**
     * Delete a broadcast
     */
    delete(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Schedule a broadcast
     */
    schedule(id: string, scheduledAt: Date | string): Promise<Broadcast>;
    /**
     * Start broadcast immediately
     */
    start(id: string): Promise<{
        success: boolean;
        recipientCount: number;
    }>;
    /**
     * Pause a running broadcast
     */
    pause(id: string): Promise<Broadcast>;
    /**
     * Resume a paused broadcast
     */
    resume(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Cancel a broadcast
     */
    cancel(id: string): Promise<Broadcast>;
    /**
     * Get broadcast statistics
     */
    getStats(id: string): Promise<BroadcastStats & {
        successRate: number;
        progress: number;
        duration: number | null;
    }>;
    /**
     * Get broadcast recipients
     */
    getRecipients(id: string, options?: {
        status?: string;
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<any>>;
}
//# sourceMappingURL=broadcast.d.ts.map
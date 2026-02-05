import type { MultiWAClient } from '../client';
import type { Webhook, CreateWebhookOptions, PaginatedResponse } from '../types';
export declare class WebhookClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Create a new webhook
     */
    create(options: CreateWebhookOptions): Promise<Webhook>;
    /**
     * List webhooks
     */
    list(profileId: string): Promise<Webhook[]>;
    /**
     * Get a webhook by ID
     */
    get(id: string): Promise<Webhook>;
    /**
     * Update a webhook
     */
    update(id: string, data: Partial<CreateWebhookOptions>): Promise<Webhook>;
    /**
     * Delete a webhook
     */
    delete(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Test webhook delivery
     */
    test(id: string): Promise<{
        success: boolean;
        statusCode: number;
        responseTime: number;
    }>;
    /**
     * Get webhook delivery logs
     */
    getLogs(id: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<{
        id: string;
        event: string;
        payload: any;
        statusCode: number;
        success: boolean;
        createdAt: Date;
    }>>;
}
//# sourceMappingURL=webhooks.d.ts.map
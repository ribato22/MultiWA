import { MessageClient } from './clients/messages';
import { ContactClient } from './clients/contacts';
import { ConversationClient } from './clients/conversations';
import { TemplateClient } from './clients/templates';
import { BroadcastClient } from './clients/broadcast';
import { WebhookClient } from './clients/webhooks';
import { AutomationClient } from './clients/automation';
export interface MultiWAClientOptions {
    /** API base URL (default: http://localhost:3000) */
    baseUrl?: string;
    /** API key for authentication */
    apiKey: string;
    /** Request timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Custom headers to include in all requests */
    headers?: Record<string, string>;
}
export declare class MultiWAClient {
    private options;
    messages: MessageClient;
    contacts: ContactClient;
    conversations: ConversationClient;
    templates: TemplateClient;
    broadcasts: BroadcastClient;
    webhooks: WebhookClient;
    automations: AutomationClient;
    constructor(options: MultiWAClientOptions);
    request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, options?: {
        body?: any;
        query?: Record<string, any>;
    }): Promise<T>;
    get<T>(path: string, query?: Record<string, any>): Promise<T>;
    post<T>(path: string, body?: any, query?: Record<string, any>): Promise<T>;
    put<T>(path: string, body?: any, query?: Record<string, any>): Promise<T>;
    delete<T>(path: string, query?: Record<string, any>): Promise<T>;
}
export declare class MultiWAError extends Error {
    statusCode: number;
    details?: any | undefined;
    constructor(message: string, statusCode: number, details?: any | undefined);
}
//# sourceMappingURL=client.d.ts.map
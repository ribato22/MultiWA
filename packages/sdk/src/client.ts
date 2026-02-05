// MultiWA Gateway SDK - Main Client
// packages/sdk/src/client.ts

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

export class MultiWAClient {
  private options: Required<MultiWAClientOptions>;

  // Sub-clients
  public messages: MessageClient;
  public contacts: ContactClient;
  public conversations: ConversationClient;
  public templates: TemplateClient;
  public broadcasts: BroadcastClient;
  public webhooks: WebhookClient;
  public automations: AutomationClient;

  constructor(options: MultiWAClientOptions) {
    this.options = {
      baseUrl: options.baseUrl || 'http://localhost:3000',
      apiKey: options.apiKey,
      timeout: options.timeout || 30000,
      headers: options.headers || {},
    };

    // Initialize sub-clients
    this.messages = new MessageClient(this);
    this.contacts = new ContactClient(this);
    this.conversations = new ConversationClient(this);
    this.templates = new TemplateClient(this);
    this.broadcasts = new BroadcastClient(this);
    this.webhooks = new WebhookClient(this);
    this.automations = new AutomationClient(this);
  }

  // HTTP request wrapper
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: {
      body?: any;
      query?: Record<string, any>;
    }
  ): Promise<T> {
    const url = new URL(path, this.options.baseUrl);

    // Add query parameters
    if (options?.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.options.apiKey,
          ...this.options.headers,
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new MultiWAError(
          error.message || `HTTP ${response.status}`,
          response.status,
          error
        );
      }

      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new MultiWAError('Request timeout', 408);
      }
      throw error;
    }
  }

  // Convenience methods
  get<T>(path: string, query?: Record<string, any>): Promise<T> {
    return this.request('GET', path, { query });
  }

  post<T>(path: string, body?: any, query?: Record<string, any>): Promise<T> {
    return this.request('POST', path, { body, query });
  }

  put<T>(path: string, body?: any, query?: Record<string, any>): Promise<T> {
    return this.request('PUT', path, { body, query });
  }

  delete<T>(path: string, query?: Record<string, any>): Promise<T> {
    return this.request('DELETE', path, { query });
  }
}

// Error class
export class MultiWAError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: any
  ) {
    super(message);
    this.name = 'MultiWAError';
  }
}

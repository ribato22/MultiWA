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
  /**
   * API base URL. Must include the API prefix `/api/v1`.
   *
   * - Local dev default: `http://localhost:3000/api/v1`
   * - Docker default:    `http://localhost:3333/api/v1`
   * - Production:        `https://your-host/api/v1`
   */
  baseUrl?: string;
  /** API key for authentication */
  apiKey: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
}

/**
 * Join an API base URL with an endpoint path while preserving the base path.
 *
 * `new URL('/messages/text', 'http://host/api/v1')` would drop `/api/v1`
 * because a path beginning with `/` is treated as absolute. This helper
 * normalizes both sides and concatenates them, so the base path survives.
 *
 * Examples:
 *   joinApiUrl('http://localhost:3333/api/v1',  'messages/text')
 *     => 'http://localhost:3333/api/v1/messages/text'
 *   joinApiUrl('http://localhost:3333/api/v1',  '/messages/text')
 *     => 'http://localhost:3333/api/v1/messages/text'
 *   joinApiUrl('http://localhost:3333/api/v1/', 'messages/text')
 *     => 'http://localhost:3333/api/v1/messages/text'
 */
export function joinApiUrl(baseUrl: string, path: string): string {
  // Linear, backtracking-free slash trimming. The previous `/\/+$/` was O(n^2)
  // (polynomial ReDoS) on a long run of leading slashes; char-scanning is O(n).
  const b = String(baseUrl || '');
  let end = b.length;
  while (end > 0 && b.charCodeAt(end - 1) === 47 /* '/' */) end--;
  const base = b.slice(0, end);

  const p = String(path || '');
  let start = 0;
  while (start < p.length && p.charCodeAt(start) === 47) start++;
  const rel = p.slice(start);

  return rel.length ? `${base}/${rel}` : base;
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
      baseUrl: options.baseUrl || 'http://localhost:3000/api/v1',
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
    // Use joinApiUrl so the base path (e.g. /api/v1) is preserved even when
    // the endpoint path starts with a leading slash.
    const url = new URL(joinApiUrl(this.options.baseUrl, path));

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

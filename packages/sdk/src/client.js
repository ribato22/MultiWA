"use strict";
// MultiWA Gateway SDK - Main Client
// packages/sdk/src/client.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiWAError = exports.MultiWAClient = void 0;
const messages_1 = require("./clients/messages");
const contacts_1 = require("./clients/contacts");
const conversations_1 = require("./clients/conversations");
const templates_1 = require("./clients/templates");
const broadcast_1 = require("./clients/broadcast");
const webhooks_1 = require("./clients/webhooks");
const automation_1 = require("./clients/automation");
class MultiWAClient {
    options;
    // Sub-clients
    messages;
    contacts;
    conversations;
    templates;
    broadcasts;
    webhooks;
    automations;
    constructor(options) {
        this.options = {
            baseUrl: options.baseUrl || 'http://localhost:3000',
            apiKey: options.apiKey,
            timeout: options.timeout || 30000,
            headers: options.headers || {},
        };
        // Initialize sub-clients
        this.messages = new messages_1.MessageClient(this);
        this.contacts = new contacts_1.ContactClient(this);
        this.conversations = new conversations_1.ConversationClient(this);
        this.templates = new templates_1.TemplateClient(this);
        this.broadcasts = new broadcast_1.BroadcastClient(this);
        this.webhooks = new webhooks_1.WebhookClient(this);
        this.automations = new automation_1.AutomationClient(this);
    }
    // HTTP request wrapper
    async request(method, path, options) {
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
                throw new MultiWAError(error.message || `HTTP ${response.status}`, response.status, error);
            }
            return response.json();
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new MultiWAError('Request timeout', 408);
            }
            throw error;
        }
    }
    // Convenience methods
    get(path, query) {
        return this.request('GET', path, { query });
    }
    post(path, body, query) {
        return this.request('POST', path, { body, query });
    }
    put(path, body, query) {
        return this.request('PUT', path, { body, query });
    }
    delete(path, query) {
        return this.request('DELETE', path, { query });
    }
}
exports.MultiWAClient = MultiWAClient;
// Error class
class MultiWAError extends Error {
    statusCode;
    details;
    constructor(message, statusCode, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'MultiWAError';
    }
}
exports.MultiWAError = MultiWAError;
//# sourceMappingURL=client.js.map
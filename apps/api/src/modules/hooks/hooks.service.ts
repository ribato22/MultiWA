// MultiWA Gateway - Hooks Service (Event Emitter + Webhook Dispatcher)
// apps/api/src/modules/hooks/hooks.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Standard event names used across the application.
 */
export enum AppEvent {
  // Message events
  MESSAGE_RECEIVED = 'message.received',
  MESSAGE_SENT = 'message.sent',
  MESSAGE_FAILED = 'message.failed',

  // Profile events
  PROFILE_CONNECTED = 'profile.connected',
  PROFILE_DISCONNECTED = 'profile.disconnected',
  PROFILE_QR_UPDATED = 'profile.qr_updated',

  // Broadcast events
  BROADCAST_STARTED = 'broadcast.started',
  BROADCAST_COMPLETED = 'broadcast.completed',
  BROADCAST_FAILED = 'broadcast.failed',

  // Contact events
  CONTACT_CREATED = 'contact.created',
  CONTACT_UPDATED = 'contact.updated',

  // Automation events
  AUTOMATION_TRIGGERED = 'automation.triggered',
  AUTOMATION_ERROR = 'automation.error',
}

export interface HookRegistration {
  id: string;
  url: string;
  events: string[]; // List of AppEvent values to subscribe to, or ['*'] for all
  secret?: string;  // Optional HMAC signing secret
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class HooksService implements OnModuleInit {
  private readonly logger = new Logger(HooksService.name);
  private hooks: HookRegistration[] = [];

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async onModuleInit() {
    await this.loadHooks();
    this.logger.log(`Hooks service initialized with ${this.hooks.length} registered webhook(s)`);
  }

  /**
   * Emit an event to all internal listeners and dispatch to webhooks.
   */
  emit(event: string, payload: any): void {
    this.eventEmitter.emit(event, payload);
    this.dispatchWebhooks(event, payload).catch((err) =>
      this.logger.error(`Webhook dispatch error: ${err.message}`),
    );
  }

  /**
   * Register an internal event listener.
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Register a new webhook hook.
   */
  async registerHook(url: string, events: string[], secret?: string): Promise<HookRegistration> {
    const hook: HookRegistration = {
      id: `hook_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      url,
      events,
      secret,
      active: true,
      createdAt: new Date(),
    };

    this.hooks.push(hook);
    await this.saveHooks();
    this.logger.log(`Webhook registered: ${url} → events: ${events.join(', ')}`);
    return hook;
  }

  /**
   * Remove a webhook hook.
   */
  async removeHook(id: string): Promise<boolean> {
    const idx = this.hooks.findIndex((h) => h.id === id);
    if (idx === -1) return false;

    this.hooks.splice(idx, 1);
    await this.saveHooks();
    this.logger.log(`Webhook removed: ${id}`);
    return true;
  }

  /**
   * List all registered hooks.
   */
  getHooks(): HookRegistration[] {
    return [...this.hooks];
  }

  /**
   * Dispatch event to all matching webhook URLs.
   */
  private async dispatchWebhooks(event: string, payload: any): Promise<void> {
    const matchingHooks = this.hooks.filter(
      (h) => h.active && (h.events.includes('*') || h.events.includes(event)),
    );

    if (matchingHooks.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const promises = matchingHooks.map(async (hook) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
        };

        // HMAC signing if secret is configured
        if (hook.secret) {
          const crypto = await import('crypto');
          const signature = crypto
            .createHmac('sha256', hook.secret)
            .update(body)
            .digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        const response = await fetch(hook.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000), // 10s timeout
        });

        if (!response.ok) {
          this.logger.warn(`Webhook ${hook.url} returned ${response.status}`);
        }
      } catch (error: any) {
        this.logger.error(`Webhook ${hook.url} failed: ${error.message}`);
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Load hooks from JSON file.
   */
  private async loadHooks(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.resolve(process.cwd(), 'data', 'hooks.json');
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        this.hooks = JSON.parse(data);
      }
    } catch {
      this.logger.warn('Could not load hooks from file, starting with empty list');
      this.hooks = [];
    }
  }

  /**
   * Save hooks to JSON file.
   */
  private async saveHooks(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(dataDir, 'hooks.json'),
        JSON.stringify(this.hooks, null, 2),
      );
    } catch (error: any) {
      this.logger.error(`Failed to save hooks: ${error.message}`);
    }
  }
}

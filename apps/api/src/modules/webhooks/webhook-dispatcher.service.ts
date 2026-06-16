// MultiWA Gateway - Webhook Dispatcher
// apps/api/src/modules/webhooks/webhook-dispatcher.service.ts
//
// Bridges the in-process app event bus to the durable BullMQ 'webhooks' queue.
// For every known app event carrying a profileId, it resolves the subscribed
// webhooks and enqueues one delivery job each. The worker (apps/worker) performs
// the actual HMAC-signed HTTP POST with retry/backoff. See
// architecture/webhook-durable-sop.md.

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { prisma } from '@multiwa/database';
import { APP_EVENT_SET } from '@multiwa/core';

/** DI token for the BullMQ 'webhooks' producer queue. */
export const WEBHOOK_QUEUE = 'WEBHOOK_QUEUE';

@Injectable()
export class WebhookDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  onModuleInit(): void {
    // onAny gives us the event name (unlike a bare @OnEvent('**') handler).
    this.eventEmitter.onAny((event: string | string[], payload: unknown) => {
      const name = Array.isArray(event) ? event.join('.') : String(event);
      void this.dispatch(name, payload);
    });
    this.logger.log('Webhook dispatcher subscribed to the application event bus');
  }

  private async dispatch(event: string, payload: any): Promise<void> {
    try {
      // Only the canonical app events drive webhooks (skips plugin-only noise).
      if (!APP_EVENT_SET.has(event)) return;

      const profileId: string | undefined = payload?.profileId;
      if (!profileId) return;

      const webhooks = await prisma.webhook.findMany({
        where: { profileId, enabled: true, events: { has: event } },
        select: { id: true },
      });
      if (webhooks.length === 0) return;

      const messageId: string | undefined = payload?.id ?? payload?.messageId;

      await Promise.all(
        webhooks.map((webhook) =>
          this.webhookQueue.add(
            'deliver',
            { webhookId: webhook.id, event, payload },
            {
              // Idempotency: dedupe the same message → same webhook. Connection
              // events have no messageId, so they get a fresh BullMQ job id.
              jobId: messageId ? `${webhook.id}:${event}:${messageId}` : undefined,
              attempts: 5,
              backoff: { type: 'exponential', delay: 30000 },
              removeOnComplete: 200,
              removeOnFail: 100,
            },
          ),
        ),
      );
    } catch (err) {
      // Never let dispatch failures disrupt the producer (engine callbacks).
      this.logger.warn(`Webhook dispatch failed for '${event}': ${(err as Error).message}`);
    }
  }
}

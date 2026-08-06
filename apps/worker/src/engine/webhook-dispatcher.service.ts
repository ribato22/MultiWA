// MultiWA Gateway - Worker webhook dispatcher
// apps/worker/src/engine/webhook-dispatcher.service.ts
//
// When ENGINE_HOST=worker the engine (and event production) live here, so the
// worker owns webhook dispatch: it subscribes to its local EventEmitter2 and
// enqueues a BullMQ 'webhooks' delivery job per matching webhook. The worker's
// WebhookProcessor performs the signed HTTP POST. The API dispatcher is
// deactivated in this mode. Port of apps/api/.../webhook-dispatcher.service.ts.

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { prisma } from '@multiwa/database';
import { APP_EVENT_SET } from '@multiwa/core';

/** DI token for the worker's BullMQ 'webhooks' producer queue. */
export const WORKER_WEBHOOK_QUEUE = 'WORKER_WEBHOOK_QUEUE';

@Injectable()
export class WorkerWebhookDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(WorkerWebhookDispatcherService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(WORKER_WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  onModuleInit(): void {
    this.eventEmitter.onAny((event: string | string[], payload: unknown) => {
      const name = Array.isArray(event) ? event.join('.') : String(event);
      void this.dispatch(name, payload);
    });
    this.logger.log('Worker webhook dispatcher subscribed to the engine event bus');
  }

  private async dispatch(event: string, payload: any): Promise<void> {
    try {
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
              jobId: messageId ? `${webhook.id}-${event}-${messageId}` : undefined,
              // Retry policy tunable: WEBHOOK_RETRY_ATTEMPTS / WEBHOOK_RETRY_DELAY_MS
              // (defaults preserve the historical 5 attempts × 30s exponential backoff).
              attempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS ?? '5', 10) || 5,
              backoff: {
                type: 'exponential',
                delay: parseInt(process.env.WEBHOOK_RETRY_DELAY_MS ?? '30000', 10) || 30000,
              },
              removeOnComplete: 200,
              removeOnFail: 100,
            },
          ),
        ),
      );
    } catch (err) {
      this.logger.warn(`Webhook dispatch failed for '${event}': ${(err as Error).message}`);
    }
  }
}

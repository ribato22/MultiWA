// MultiWA Gateway - Worker engine Nest module
// apps/worker/src/engine/worker-engine.module.ts
//
// The Nest application context the worker bootstraps when ENGINE_HOST=worker. It
// hosts the WhatsApp engine (sessions, QR, receive) plus the send gate, the
// realtime publisher (→ Redis → API Socket.IO), and the webhook dispatcher.
// See architecture/engine-worker-migration-sop.md.

import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { REALTIME_EMITTER } from '@multiwa/core';
import { SendGateService } from '@multiwa/engine-runtime';
import { RealtimePublisherService } from './realtime-publisher.service';
import { EngineManagerService } from './engine-manager.service';
import { WorkerMessagesService } from './messages.service';
import { WorkerAutomationService } from './automation.service';
import { AIService } from './ai.service';
import { WorkerRuleEngineService } from './rule-engine.service';
import { WorkerWebhookDispatcherService, WORKER_WEBHOOK_QUEUE } from './webhook-dispatcher.service';

@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    RealtimePublisherService,
    // The engine emits realtime events via the Redis publisher in the worker.
    { provide: REALTIME_EMITTER, useExisting: RealtimePublisherService },
    SendGateService,
    EngineManagerService,
    WorkerMessagesService,
    WorkerAutomationService,
    AIService,
    WorkerRuleEngineService,
    WorkerWebhookDispatcherService,
    {
      // Worker-side BullMQ 'webhooks' producer (the WebhookProcessor consumes it).
      provide: WORKER_WEBHOOK_QUEUE,
      useFactory: () =>
        new Queue('webhooks', {
          connection: new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
          }),
        }),
    },
  ],
  exports: [EngineManagerService, WorkerMessagesService],
})
export class WorkerEngineModule implements OnModuleDestroy {
  constructor(@Inject(WORKER_WEBHOOK_QUEUE) private readonly webhookQueue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.webhookQueue.close();
  }
}

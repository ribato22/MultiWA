// MultiWA Gateway - Webhooks Module
// apps/api/src/modules/webhooks/webhooks.module.ts

import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatcherService, WEBHOOK_QUEUE } from './webhook-dispatcher.service';

@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookDispatcherService,
    {
      // API-side BullMQ producer for the 'webhooks' queue consumed by apps/worker.
      // Raw bullmq (not @nestjs/bull) so the queue format matches the worker.
      provide: WEBHOOK_QUEUE,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
        return new Queue('webhooks', {
          connection: new IORedis(url, { maxRetriesPerRequest: null }),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [WebhooksService],
})
export class WebhooksModule implements OnModuleDestroy {
  constructor(@Inject(WEBHOOK_QUEUE) private readonly webhookQueue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.webhookQueue.close();
  }
}

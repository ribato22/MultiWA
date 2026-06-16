// MultiWA Gateway - Engine Commands Module
// apps/api/src/modules/engine-commands/engine-commands.module.ts

import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { EngineCommandsService, ENGINE_COMMANDS_QUEUE } from './engine-commands.service';

@Global()
@Module({
  providers: [
    EngineCommandsService,
    {
      // Producer queue for API -> worker engine commands (consumed by the worker
      // when ENGINE_HOST=worker). Raw bullmq to match the worker consumer.
      provide: ENGINE_COMMANDS_QUEUE,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
        return new Queue('engine-commands', {
          connection: new IORedis(url, { maxRetriesPerRequest: null }),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [EngineCommandsService],
})
export class EngineCommandsModule implements OnModuleDestroy {
  constructor(@Inject(ENGINE_COMMANDS_QUEUE) private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}

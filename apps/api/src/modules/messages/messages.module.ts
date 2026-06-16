// apps/api/src/modules/messages/messages.module.ts
import { Module, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ScheduledMessageCron } from './scheduled-message.cron';
import { SendGateService } from './send-gate.service';
import { DailyResetCron } from './daily-reset.cron';
import { OutboundSendConsumer } from './outbound-send.consumer';
import { OUTBOUND_SEND_QUEUE } from './outbound-send';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    ScheduledMessageCron,
    SendGateService,
    DailyResetCron,
    OutboundSendConsumer,
    {
      // Producer queue for the durable outbound-send path (consumed in-process by
      // OutboundSendConsumer). Raw bullmq so the format matches the consumer.
      provide: OUTBOUND_SEND_QUEUE,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
        return new Queue('outbound-send', {
          connection: new IORedis(url, { maxRetriesPerRequest: null }),
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [MessagesService, SendGateService],
})
export class MessagesModule implements OnModuleDestroy {
  constructor(@Inject(OUTBOUND_SEND_QUEUE) private readonly outboundQueue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.outboundQueue.close();
  }
}

// MultiWA Gateway - Broadcast Module
// apps/api/src/modules/broadcast/broadcast.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { BroadcastSchedulerCron } from './broadcast-scheduler.cron';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [forwardRef(() => MessagesModule)],
  controllers: [BroadcastController],
  providers: [BroadcastService, BroadcastSchedulerCron],
  exports: [BroadcastService],
})
export class BroadcastModule {}

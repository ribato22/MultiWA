// apps/api/src/modules/messages/messages.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ScheduledMessageCron } from './scheduled-message.cron';
import { SendGateService } from './send-gate.service';
import { DailyResetCron } from './daily-reset.cron';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [MessagesController],
  providers: [MessagesService, ScheduledMessageCron, SendGateService, DailyResetCron],
  exports: [MessagesService, SendGateService],
})
export class MessagesModule {}

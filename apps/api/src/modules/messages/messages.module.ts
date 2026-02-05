// apps/api/src/modules/messages/messages.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ScheduledMessageCron } from './scheduled-message.cron';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [MessagesController],
  providers: [MessagesService, ScheduledMessageCron],
  exports: [MessagesService],
})
export class MessagesModule {}

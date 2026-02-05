// MultiWA Gateway API - Notifications Module
// apps/api/src/modules/notifications/notifications.module.ts

import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { PushService } from './push.service';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';

@Global()
@Module({
  imports: [SettingsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailService,
    PushService,
    {
      provide: 'SETTINGS_SERVICE',
      useExisting: SettingsService,
    },
  ],
  exports: [NotificationsService, EmailService, PushService],
})
export class NotificationsModule {}

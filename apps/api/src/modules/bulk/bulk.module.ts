// MultiWA Gateway - Bulk Module
// apps/api/src/modules/bulk/bulk.module.ts

import { Module } from '@nestjs/common';
import { BulkController } from './bulk.controller';
import { BulkService } from './bulk.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [ProfilesModule, MessagesModule],
  controllers: [BulkController],
  providers: [BulkService],
  exports: [BulkService],
})
export class BulkModule {}

// MultiWA Gateway API - Accounts Module
// apps/api/src/modules/accounts/accounts.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { GdprController } from './gdpr.controller';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [AccountsController, GdprController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}


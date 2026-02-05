// MultiWA Gateway API - Profiles Module
// apps/api/src/modules/profiles/profiles.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { EngineManagerService } from './engine-manager.service';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    forwardRef(() => AutomationModule),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, EngineManagerService],
  exports: [ProfilesService, EngineManagerService],
})
export class ProfilesModule {}

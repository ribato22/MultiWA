// MultiWA Gateway - Automation Module
// apps/api/src/modules/automation/automation.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';
import { MessagesModule } from '../messages/messages.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => MessagesModule), forwardRef(() => ProfilesModule)],
  controllers: [AutomationController],
  providers: [AutomationService, RuleEngineService],
  exports: [AutomationService, RuleEngineService],
})
export class AutomationModule {}

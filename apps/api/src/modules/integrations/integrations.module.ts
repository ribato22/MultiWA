// MultiWA Gateway - Integrations Module
// apps/api/src/modules/integrations/integrations.module.ts

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeBotService } from './typebot.service';
import { ChatwootService } from './chatwoot.service';
import { IntegrationsController } from './integrations.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [IntegrationsController],
  providers: [TypeBotService, ChatwootService],
  exports: [TypeBotService, ChatwootService],
})
export class IntegrationsModule {}

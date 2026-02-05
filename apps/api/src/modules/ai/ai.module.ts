// MultiWA Gateway - AI Module (Sprint 3: Knowledge Base)
// apps/api/src/modules/ai/ai.module.ts

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIService } from './ai.service';
import { AIController } from './ai.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [AIController, KnowledgeBaseController],
  providers: [AIService, KnowledgeBaseService],
  exports: [AIService, KnowledgeBaseService],
})
export class AIModule {}

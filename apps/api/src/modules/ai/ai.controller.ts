// MultiWA Gateway - AI Controller
// apps/api/src/modules/ai/ai.controller.ts

import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { AIService } from './ai.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors, ApiValidationError } from '../../common/decorators/api-responses';

class CompleteDto {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

class AutoReplyDto {
  message: string;
  customerName?: string;
  businessName?: string;
  previousMessages?: string[];
  customPrompt?: string;
}

class TranslateDto {
  message: string;
  targetLanguage?: string;
}

class SentimentDto {
  message: string;
}

@ApiTags('AI')
@Controller('ai')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Get('status')
  @ApiOperation({ summary: 'Check AI service status' })
  status() {
    return {
      configured: this.aiService.isConfigured(),
      provider: 'openai',
    };
  }

  @Post('complete')
  @ApiOperation({
    summary: 'Generate AI completion',
    description:
      'Runs a free-form prompt through the configured AI provider and returns the completion. Supports optional model, max tokens, temperature, and system prompt overrides.',
  })
  @ApiValidationError()
  async complete(@Body() dto: CompleteDto) {
    return this.aiService.complete(dto.prompt, {
      model: dto.model,
      maxTokens: dto.maxTokens,
      temperature: dto.temperature,
      systemPrompt: dto.systemPrompt,
    });
  }

  @Post('auto-reply')
  @ApiOperation({
    summary: 'Generate automatic reply for customer message',
    description:
      'Produces a suggested reply to an inbound customer message, optionally conditioned on customer name, business name, prior conversation turns, and a custom prompt.',
  })
  @ApiValidationError()
  async autoReply(@Body() dto: AutoReplyDto) {
    return this.aiService.generateAutoReply(dto.message, {
      customerName: dto.customerName,
      businessName: dto.businessName,
      previousMessages: dto.previousMessages,
      customPrompt: dto.customPrompt,
    });
  }

  @Post('sentiment')
  @ApiOperation({
    summary: 'Analyze message sentiment',
    description: 'Classifies the sentiment (e.g. positive, neutral, negative) of a single message.',
  })
  @ApiValidationError()
  async sentiment(@Body() dto: SentimentDto) {
    return this.aiService.analyzeSentiment(dto.message);
  }

  @Post('translate')
  @ApiOperation({
    summary: 'Translate message to target language',
    description: 'Translates the given message into the requested target language (defaults to the service default when omitted).',
  })
  @ApiValidationError()
  async translate(@Body() dto: TranslateDto) {
    return this.aiService.translate(dto.message, dto.targetLanguage);
  }
}

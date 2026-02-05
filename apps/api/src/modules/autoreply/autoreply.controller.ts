// MultiWA Gateway - Autoreply Controller
// apps/api/src/modules/autoreply/autoreply.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { AutoreplyService } from './autoreply.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateAutoreplyDto, UpdateAutoreplyDto, QuickReplyDto } from './dto';

@ApiTags('Autoreply')
@Controller('autoreply')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class AutoreplyController {
  constructor(private readonly service: AutoreplyService) {}

  // Quick Replies (preset responses)
  @Post('quick-replies')
  @ApiOperation({ summary: 'Create quick reply preset' })
  async createQuickReply(@Body() dto: QuickReplyDto) {
    return this.service.createQuickReply(dto);
  }

  @Get('quick-replies')
  @ApiOperation({ summary: 'List quick replies' })
  @ApiQuery({ name: 'profileId', required: true })
  async listQuickReplies(@Query('profileId') profileId: string) {
    return this.service.listQuickReplies(profileId);
  }

  @Delete('quick-replies/:id')
  @ApiOperation({ summary: 'Delete quick reply' })
  async deleteQuickReply(@Param('id') id: string) {
    return this.service.deleteQuickReply(id);
  }

  // Keyword Autoreplies (simple version of automation)
  @Post()
  @ApiOperation({ summary: 'Create keyword autoreply' })
  async create(@Body() dto: CreateAutoreplyDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List keyword autoreplies' })
  @ApiQuery({ name: 'profileId', required: true })
  async findAll(@Query('profileId') profileId: string) {
    return this.service.findAll(profileId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get autoreply by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update autoreply' })
  async update(@Param('id') id: string, @Body() dto: UpdateAutoreplyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete autoreply' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Put(':id/toggle')
  @ApiOperation({ summary: 'Toggle autoreply on/off' })
  async toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  // Webhook Dynamic Reply
  @Post('webhook-reply')
  @ApiOperation({ summary: 'Configure webhook for dynamic replies' })
  async configureWebhookReply(@Body() body: { profileId: string; webhookUrl: string; enabled: boolean }) {
    return this.service.configureWebhookReply(body.profileId, body.webhookUrl, body.enabled);
  }

  @Get('webhook-reply/:profileId')
  @ApiOperation({ summary: 'Get webhook reply configuration' })
  async getWebhookReply(@Param('profileId') profileId: string) {
    return this.service.getWebhookReply(profileId);
  }

  // AI Bot Hook
  @Post('ai-hook')
  @ApiOperation({ summary: 'Configure AI bot hook (Dialogflow, GPT, etc)' })
  async configureAiHook(@Body() body: { 
    profileId: string; 
    provider: string; 
    config: any;
    enabled: boolean;
  }) {
    return this.service.configureAiHook(body.profileId, body.provider, body.config, body.enabled);
  }

  @Get('ai-hook/:profileId')
  @ApiOperation({ summary: 'Get AI hook configuration' })
  async getAiHook(@Param('profileId') profileId: string) {
    return this.service.getAiHook(profileId);
  }
}

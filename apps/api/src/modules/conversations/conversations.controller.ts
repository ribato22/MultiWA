// MultiWA Gateway - Conversations Controller
// apps/api/src/modules/conversations/conversations.controller.ts

import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Conversations')
@Controller('conversations')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'type', required: false, enum: ['user', 'group', 'broadcast'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.service.findAll(profileId, { type, limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation with messages' })
  @ApiQuery({ name: 'messageLimit', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('messageLimit') messageLimit?: number,
  ) {
    return this.service.findOne(id, messageLimit);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark conversation as read' })
  async markAsRead(@Param('id') id: string) {
    return this.service.markAsRead(id);
  }

  @Put(':id/archive')
  @ApiOperation({ summary: 'Archive conversation' })
  async archive(@Param('id') id: string) {
    return this.service.archive(id);
  }

  @Put(':id/unarchive')
  @ApiOperation({ summary: 'Unarchive conversation' })
  async unarchive(@Param('id') id: string) {
    return this.service.unarchive(id);
  }

  @Put(':id/mute')
  @ApiOperation({ summary: 'Toggle mute conversation' })
  async toggleMute(@Param('id') id: string) {
    return this.service.toggleMute(id);
  }

  @Put(':id/pin')
  @ApiOperation({ summary: 'Toggle pin conversation' })
  async togglePin(@Param('id') id: string) {
    return this.service.togglePin(id);
  }

  @Delete(':id/messages')
  @ApiOperation({ summary: 'Clear all messages in conversation' })
  async clearMessages(@Param('id') id: string) {
    return this.service.clearMessages(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete conversation and messages' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get messages in conversation' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'Get messages before this ID' })
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    return this.service.getMessages(id, { limit, before });
  }
}

// MultiWA Gateway - Conversations Controller
// apps/api/src/modules/conversations/conversations.controller.ts

import { Controller, Get, Put, Delete, Param, Query, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('Conversations')
@Controller('conversations')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class ConversationsController {
  constructor(private readonly service: ConversationsService) {}

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
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

  // NOTE: must be declared BEFORE @Get(':id') so the literal path isn't captured by :id.
  @Get('unread-count')
  @ApiOperation({ summary: 'Total unread message count across the org' })
  async unreadCount(@Request() req: any) {
    const count = await this.service.getOrgUnreadCount(req.user.organizationId);
    return { count };
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Get conversation with messages' })
  @ApiNotFound('Conversation')
  @ApiQuery({ name: 'messageLimit', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('messageLimit') messageLimit?: number,
  ) {
    return this.service.findOne(id, messageLimit);
  }

  @Put(':id/read')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Mark conversation as read' })
  @ApiNotFound('Conversation')
  async markAsRead(@Param('id') id: string) {
    return this.service.markAsRead(id);
  }

  @Put(':id/archive')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Archive conversation' })
  @ApiNotFound('Conversation')
  async archive(@Param('id') id: string) {
    return this.service.archive(id);
  }

  @Put(':id/unarchive')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Unarchive conversation' })
  @ApiNotFound('Conversation')
  async unarchive(@Param('id') id: string) {
    return this.service.unarchive(id);
  }

  @Put(':id/mute')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Toggle mute conversation' })
  @ApiNotFound('Conversation')
  async toggleMute(@Param('id') id: string) {
    return this.service.toggleMute(id);
  }

  @Put(':id/pin')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Toggle pin conversation' })
  @ApiNotFound('Conversation')
  async togglePin(@Param('id') id: string) {
    return this.service.togglePin(id);
  }

  @Delete(':id/messages')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Clear all messages in conversation' })
  @ApiNotFound('Conversation')
  async clearMessages(@Param('id') id: string) {
    return this.service.clearMessages(id);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Delete conversation and messages' })
  @ApiNotFound('Conversation')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Get(':id/messages')
  @RequireTenant({ from: 'param', key: 'id', resource: 'conversation' })
  @ApiOperation({ summary: 'Get messages in conversation' })
  @ApiNotFound('Conversation')
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

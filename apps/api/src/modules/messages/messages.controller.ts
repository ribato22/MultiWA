// MultiWA Gateway - Enhanced Messages Controller
// apps/api/src/modules/messages/messages.controller.ts

import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Req, applyDecorators, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery, ApiCreatedResponse } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiRateLimited, ApiNotFound } from '../../common/decorators/api-responses';
import { MessagesService } from './messages.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import {
  SendTextDto,
  SendImageDto,
  SendVideoDto,
  SendAudioDto,
  SendDocumentDto,
  SendLocationDto,
  SendContactDto,
  SendReactionDto,
  SendReplyDto,
  SendPollDto,
  SendTypingDto,
  MarkAsReadDto,
  DeleteForEveryoneDto,
  ScheduleMessageDto,
  SendMessageResponse,
  SendOtpDto,
} from './dto';
import { OtpService } from './otp.service';
import { AuditService, AuditAction } from '../audit/audit.service';

// Composite for the send endpoints: operation summary + the queued 201 response +
// 400 (validation) + 429 (daily limit). 401/403 come from the class-level @ApiAuthErrors.
const ApiSend = (summary: string, description?: string) =>
  applyDecorators(
    ApiOperation({ summary, description }),
    ApiCreatedResponse({ description: 'Message accepted and queued for delivery.', type: SendMessageResponse }),
    ApiValidationError(),
    ApiRateLimited(),
  );

@ApiTags('Messages')
@Controller('messages')
// ApiKeyScopeGuard runs between auth and tenant: a cheap in-memory capability
// check before the per-resource tenant DB lookup. Class default requires the
// `message:send` scope; the read (GET) routes below override it to `message:read`.
// No-op for JWT logins and for API keys with no scopes / a `*` wildcard.
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard)
@RequireScope('message:send')
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly otp: OtpService,
    private readonly auditService: AuditService,
  ) {}

  // Send text message
  @Post('text')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send text message', 'Queue a plain-text WhatsApp message.')
  async sendText(@Body() dto: SendTextDto, @Req() req: any) {
    const result = await this.service.sendText(dto);
    this.auditService.log({
      action: AuditAction.MESSAGE_SEND,
      userId: req.user?.id,
      resourceType: 'message',
      metadata: { type: 'text', profileId: dto.profileId, to: dto.to },
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }

  // Send OTP with delivery-confirmed failover to a secondary channel.
  @Post('otp')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend(
    'Send an OTP with failover',
    'Sends the OTP over the primary WhatsApp number; if the cold circuit is open or delivery is not confirmed within the ack timeout, it fails over to the configured secondary template channel. Returns which channel delivered it.',
  )
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: any) {
    const result = await this.otp.sendOtp(dto.profileId, dto.to, dto.text, dto.code);
    this.auditService.log({
      action: AuditAction.MESSAGE_SEND,
      userId: req.user?.id,
      resourceType: 'message',
      metadata: { type: 'otp', profileId: dto.profileId, to: dto.to, channel: result.channel, success: result.success },
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    // Total delivery failure (no channel delivered) must surface as a non-2xx so
    // callers that gate on HTTP status don't treat an undelivered OTP as sent.
    if (!result.success) {
      throw new HttpException(
        { error: 'OTP_DELIVERY_FAILED', channel: result.channel, reason: result.reason },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return result;
  }

  // Send image
  @Post('image')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send image message', 'Queue an image by URL or base64, with an optional caption.')
  async sendImage(@Body() dto: SendImageDto) {
    return this.service.sendImage(dto);
  }

  // Send video
  @Post('video')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send video message', 'Queue a video by URL or base64, with an optional caption.')
  async sendVideo(@Body() dto: SendVideoDto) {
    return this.service.sendVideo(dto);
  }

  // Send audio/voice note
  @Post('audio')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send audio/voice note', 'Queue an audio clip; set ptt=true for a push-to-talk voice note.')
  async sendAudio(@Body() dto: SendAudioDto) {
    return this.service.sendAudio(dto);
  }

  // Send document
  @Post('document')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send document/file', 'Queue a document (PDF, DOCX, …) by URL or base64.')
  async sendDocument(@Body() dto: SendDocumentDto) {
    return this.service.sendDocument(dto);
  }

  // Send location
  @Post('location')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send location', 'Queue a location pin (latitude/longitude, optional name/address).')
  async sendLocation(@Body() dto: SendLocationDto) {
    return this.service.sendLocation(dto);
  }

  // Send contact card
  @Post('contact')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send contact card (vCard)', 'Queue one or more contacts as vCards.')
  async sendContact(@Body() dto: SendContactDto) {
    return this.service.sendContact(dto);
  }

  // Send reaction
  @Post('reaction')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('React to a message', 'Add or change an emoji reaction on a message.')
  async sendReaction(@Body() dto: SendReactionDto) {
    return this.service.sendReaction(dto);
  }

  // Reply to message
  @Post('reply')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Reply to a message', 'Send a message that quotes an existing one.')
  async sendReply(@Body() dto: SendReplyDto) {
    return this.service.sendReply(dto);
  }

  // Send poll
  @Post('poll')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiSend('Send interactive poll', 'Queue a poll with options and single/multi-select.')
  async sendPoll(@Body() dto: SendPollDto) {
    return this.service.sendPoll(dto);
  }

  // ========== Typing Indicator ==========
  @Post('typing')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Send typing indicator (composing/recording)', description: 'Show typing or recording state in WhatsApp chat. Optionally auto-clears after a given duration.' })
  @ApiValidationError()
  async sendTyping(@Body() dto: SendTypingDto) {
    return this.service.sendTyping(dto.profileId, dto.to, dto.state || 'composing', dto.duration);
  }

  // ========== Read Receipt Control ==========
  @Post('mark-read')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Mark messages/chat as read', description: 'Send read receipts (blue ticks) for specific messages or entire chat.' })
  @ApiValidationError()
  async markAsRead(@Body() dto: MarkAsReadDto) {
    return this.service.markAsRead(dto.profileId, dto.chatId, dto.messageIds);
  }

  // ========== Delete for Everyone ==========
  @Post('delete-for-everyone')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Delete message for everyone', description: 'Delete a sent message from WhatsApp for all participants. Only works for messages sent by you.' })
  @ApiValidationError()
  async deleteForEveryone(@Body() dto: DeleteForEveryoneDto) {
    return this.service.deleteForEveryone(dto.profileId, dto.chatId, dto.messageId);
  }

  // ========== Message Scheduling ==========
  @Post('schedule')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Schedule a message for future delivery', description: 'Persist a message to be sent at scheduledAt (ISO 8601). Manage via the schedule endpoints below.' })
  @ApiValidationError()
  async scheduleMessage(@Body() dto: ScheduleMessageDto) {
    return this.service.scheduleMessage(dto.profileId, dto.to, dto.type, dto.content, dto.scheduledAt);
  }

  @Get('schedule/:profileId')
  @RequireScope('message:read')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get scheduled messages by profile' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'sent', 'failed', 'cancelled'] })
  async getScheduledMessages(
    @Param('profileId') profileId: string,
    @Query('status') status?: string,
  ) {
    return this.service.getScheduledMessages(profileId, status);
  }

  @Delete('schedule/:id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'scheduledMessage' })
  @ApiOperation({ summary: 'Cancel a scheduled message' })
  async cancelScheduledMessage(@Param('id') id: string) {
    return this.service.cancelScheduledMessage(id);
  }

  // Get messages by profile
  @Get('profile/:profileId')
  @RequireScope('message:read')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get messages by profile' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact'] })
  @ApiQuery({ name: 'direction', required: false, enum: ['incoming', 'outgoing'] })
  async findByProfile(
    @Param('profileId') profileId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('type') type?: string,
    @Query('direction') direction?: string,
  ) {
    return this.service.findByProfile(profileId, { limit, offset, type, direction });
  }

  // Get messages by conversation
  @Get('conversation/:conversationId')
  @RequireScope('message:read')
  @RequireTenant({ from: 'param', key: 'conversationId', resource: 'conversation' })
  @ApiOperation({ summary: 'Get messages by conversation' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'Get messages before this ID' })
  async findByConversation(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
    @Query('before') before?: string,
  ) {
    return this.service.findByConversation(conversationId, { limit, before });
  }

  // Load older messages on-demand: pulls deeper history from WhatsApp, persists it,
  // and returns the refreshed page. Profile must be connected.
  @Get('conversation/:conversationId/load-older')
  @RequireScope('message:read')
  @RequireTenant({ from: 'param', key: 'conversationId', resource: 'conversation' })
  @ApiOperation({ summary: 'Fetch older messages for a conversation from WhatsApp and persist them' })
  @ApiQuery({ name: 'limit', required: false, description: 'Total most-recent messages to pull (default 100, max 500)' })
  async loadOlder(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: number,
  ) {
    return this.service.loadOlderMessages(conversationId, Number(limit) || 100);
  }

  // Get single message
  @Get(':id')
  @RequireScope('message:read')
  @RequireTenant({ from: 'param', key: 'id', resource: 'message' })
  @ApiOperation({ summary: 'Get message by ID' })
  @ApiNotFound('Message')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Delete message (from local database)
  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'message' })
  @ApiOperation({ summary: 'Delete message from database' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

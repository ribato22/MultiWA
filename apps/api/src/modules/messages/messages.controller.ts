// MultiWA Gateway - Enhanced Messages Controller
// apps/api/src/modules/messages/messages.controller.ts

import { Controller, Get, Post, Delete, Put, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
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
} from './dto';
import { AuditService, AuditAction } from '../audit/audit.service';

@ApiTags('Messages')
@Controller('messages')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly auditService: AuditService,
  ) {}

  // Send text message
  @Post('text')
  @ApiOperation({ summary: 'Send text message' })
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

  // Send image
  @Post('image')
  @ApiOperation({ summary: 'Send image message' })
  async sendImage(@Body() dto: SendImageDto) {
    return this.service.sendImage(dto);
  }

  // Send video
  @Post('video')
  @ApiOperation({ summary: 'Send video message' })
  async sendVideo(@Body() dto: SendVideoDto) {
    return this.service.sendVideo(dto);
  }

  // Send audio/voice note
  @Post('audio')
  @ApiOperation({ summary: 'Send audio/voice note' })
  async sendAudio(@Body() dto: SendAudioDto) {
    return this.service.sendAudio(dto);
  }

  // Send document
  @Post('document')
  @ApiOperation({ summary: 'Send document/file' })
  async sendDocument(@Body() dto: SendDocumentDto) {
    return this.service.sendDocument(dto);
  }

  // Send location
  @Post('location')
  @ApiOperation({ summary: 'Send location' })
  async sendLocation(@Body() dto: SendLocationDto) {
    return this.service.sendLocation(dto);
  }

  // Send contact card
  @Post('contact')
  @ApiOperation({ summary: 'Send contact card (vCard)' })
  async sendContact(@Body() dto: SendContactDto) {
    return this.service.sendContact(dto);
  }

  // Send reaction
  @Post('reaction')
  @ApiOperation({ summary: 'React to a message' })
  async sendReaction(@Body() dto: SendReactionDto) {
    return this.service.sendReaction(dto);
  }

  // Reply to message
  @Post('reply')
  @ApiOperation({ summary: 'Reply to a message' })
  async sendReply(@Body() dto: SendReplyDto) {
    return this.service.sendReply(dto);
  }

  // Send poll
  @Post('poll')
  @ApiOperation({ summary: 'Send interactive poll' })
  async sendPoll(@Body() dto: SendPollDto) {
    return this.service.sendPoll(dto);
  }

  // ========== NEW: Typing Indicator ==========
  @Post('typing')
  @ApiOperation({ summary: 'Send typing indicator (composing/recording)', description: 'Show typing or recording state in WhatsApp chat. Optionally auto-clears after a given duration.' })
  async sendTyping(@Body() dto: SendTypingDto) {
    return this.service.sendTyping(dto.profileId, dto.to, dto.state || 'composing', dto.duration);
  }

  // ========== NEW: Read Receipt Control ==========
  @Post('mark-read')
  @ApiOperation({ summary: 'Mark messages/chat as read', description: 'Send read receipts (blue ticks) for specific messages or entire chat.' })
  async markAsRead(@Body() dto: MarkAsReadDto) {
    return this.service.markAsRead(dto.profileId, dto.chatId, dto.messageIds);
  }

  // ========== NEW: Delete for Everyone ==========
  @Post('delete-for-everyone')
  @ApiOperation({ summary: 'Delete message for everyone', description: 'Delete a sent message from WhatsApp for all participants. Only works for messages sent by you.' })
  async deleteForEveryone(@Body() dto: DeleteForEveryoneDto) {
    return this.service.deleteForEveryone(dto.profileId, dto.chatId, dto.messageId);
  }

  // ========== NEW: Message Scheduling ==========
  @Post('schedule')
  @ApiOperation({ summary: 'Schedule a message for future delivery' })
  async scheduleMessage(@Body() dto: ScheduleMessageDto) {
    return this.service.scheduleMessage(dto.profileId, dto.to, dto.type, dto.content, dto.scheduledAt);
  }

  @Get('schedule/:profileId')
  @ApiOperation({ summary: 'Get scheduled messages by profile' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'sent', 'failed', 'cancelled'] })
  async getScheduledMessages(
    @Param('profileId') profileId: string,
    @Query('status') status?: string,
  ) {
    return this.service.getScheduledMessages(profileId, status);
  }

  @Delete('schedule/:id')
  @ApiOperation({ summary: 'Cancel a scheduled message' })
  async cancelScheduledMessage(@Param('id') id: string) {
    return this.service.cancelScheduledMessage(id);
  }

  // Get messages by profile
  @Get('profile/:profileId')
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

  // Get single message
  @Get(':id')
  @ApiOperation({ summary: 'Get message by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Delete message (from local database)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete message from database' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

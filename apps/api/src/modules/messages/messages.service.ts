// MultiWA Gateway - Enhanced Messages Service
// apps/api/src/modules/messages/messages.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
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
} from './dto';
import { EngineManagerService } from '../profiles/engine-manager.service';


@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
  ) {}
  // Send text message
  async sendText(dto: SendTextDto) {
    return this.queueMessage(dto.profileId, dto.to, 'text', {
      text: dto.text,
    }, dto.quotedMessageId);
  }

  // Send image
  async sendImage(dto: SendImageDto) {
    return this.queueMessage(dto.profileId, dto.to, 'image', {
      url: dto.url,
      base64: dto.base64,
      caption: dto.caption,
      mimetype: dto.mimetype || 'image/jpeg',
    });
  }

  // Send video
  async sendVideo(dto: SendVideoDto) {
    return this.queueMessage(dto.profileId, dto.to, 'video', {
      url: dto.url,
      base64: dto.base64,
      caption: dto.caption,
      mimetype: dto.mimetype || 'video/mp4',
    });
  }

  // Send audio
  async sendAudio(dto: SendAudioDto) {
    return this.queueMessage(dto.profileId, dto.to, 'audio', {
      url: dto.url,
      base64: dto.base64,
      mimetype: dto.mimetype || 'audio/mpeg',
      ptt: dto.ptt || false, // Push to talk (voice note)
    });
  }

  // Send document
  async sendDocument(dto: SendDocumentDto) {
    return this.queueMessage(dto.profileId, dto.to, 'document', {
      url: dto.url,
      base64: dto.base64,
      filename: dto.filename,
      caption: dto.caption,
      mimetype: dto.mimetype || 'application/octet-stream',
    });
  }

  // Send location
  async sendLocation(dto: SendLocationDto) {
    return this.queueMessage(dto.profileId, dto.to, 'location', {
      latitude: dto.latitude,
      longitude: dto.longitude,
      name: dto.name,
      address: dto.address,
    });
  }

  // Send contact card
  async sendContact(dto: SendContactDto) {
    return this.queueMessage(dto.profileId, dto.to, 'contact', {
      contacts: dto.contacts.map(c => ({
        displayName: c.name,
        vcard: this.generateVCard(c),
      })),
      // Also pass original contact data for engine compatibility
      name: dto.contacts[0]?.name,
      phone: dto.contacts[0]?.phone,
    });
  }

  // Send reaction
  async sendReaction(dto: SendReactionDto) {
    const message = await prisma.message.findUnique({
      where: { id: dto.messageId },
      include: { conversation: true },
    });
    
    if (!message) throw new NotFoundException('Message not found');

    return this.queueMessage(
      dto.profileId,
      message.conversation.jid,
      'reaction',
      {
        messageId: message.messageId,
        emoji: dto.emoji,
      }
    );
  }

  // Reply to message
  async sendReply(dto: SendReplyDto) {
    const quotedMessage = await prisma.message.findUnique({
      where: { id: dto.quotedMessageId },
      include: { conversation: true },
    });
    
    if (!quotedMessage) throw new NotFoundException('Quoted message not found');

    return this.queueMessage(
      dto.profileId,
      quotedMessage.conversation.jid,
      'text',
      { text: dto.text },
      dto.quotedMessageId
    );
  }

  // Send poll
  async sendPoll(dto: SendPollDto) {
    if (dto.options.length < 2) {
      throw new BadRequestException('Poll must have at least 2 options');
    }
    if (dto.options.length > 12) {
      throw new BadRequestException('Poll cannot have more than 12 options');
    }
    
    return this.queueMessage(dto.profileId, dto.to, 'poll', {
      question: dto.question,
      options: dto.options,
      allowMultipleAnswers: dto.allowMultipleAnswers || false,
    });
  }

  // Core queue method

  private async queueMessage(
    profileId: string,
    to: string,
    type: string,
    content: any,
    quotedMessageId?: string,
  ) {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    // Normalize phone/JID
    this.logger.debug(`Normalizing JID: input="${to}"`);
    const jid = this.normalizeJid(to);
    this.logger.debug(`Normalized JID: output="${jid}"`);

    // Get or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { profileId, jid },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          profileId,
          jid,
          name: to,
          type: jid.includes('@g.us') ? 'group' : 'user',
        },
      });
    }

    // Create message record
    const message = await prisma.message.create({
      data: {
        profileId,
        conversationId: conversation.id,
        messageId: `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        direction: 'outgoing',
        senderJid: profile.phoneNumber || 'unknown',
        type,
        content,
        status: 'pending',
        timestamp: new Date(),
        quotedMessageId,
      },
    });

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    // Send via WhatsApp engine
    try {
      const engine = this.engineManager.getEngine(profileId);
      
      if (!engine) {
        this.logger.warn(`No engine found for profile ${profileId}, message queued as pending`);
        return {
          success: true,
          messageId: message.id,
          conversationId: conversation.id,
          status: 'pending',
          warning: 'Profile not connected, message queued',
        };
      }

      // Send message through engine based on type
      // Rewrite media URLs: S3_PUBLIC_URL uses localhost:9000 for browser access,
      // but inside Docker the engine needs minio:9000 (Docker internal network)
      let result;
      const engineContent = { ...content };
      if (engineContent.url && typeof engineContent.url === 'string') {
        engineContent.url = engineContent.url
          .replace('://localhost:9000', '://minio:9000')
          .replace('://127.0.0.1:9000', '://minio:9000');
      }
      switch (type) {
        case 'text':
          result = await engine.sendText(jid, engineContent.text, { quotedMessageId });
          break;
        case 'image':
          result = await engine.sendImage(jid, engineContent);
          break;
        case 'video':
          result = await engine.sendVideo(jid, engineContent);
          break;
        case 'audio':
          result = await engine.sendAudio(jid, engineContent);
          break;
        case 'document':
          result = await engine.sendDocument(jid, engineContent);
          break;
        case 'location':
          result = await engine.sendLocation(jid, content);
          break;
        case 'contact':
          result = await engine.sendContact(jid, content);
          break;
        case 'poll':
          result = await engine.sendPoll(jid, content);
          break;
        case 'reaction':
          result = await engine.sendReaction(content.messageId, content.emoji);
          break;
        default:
          this.logger.warn(`Unknown message type: ${type}`);
          result = await engine.sendText(jid, JSON.stringify(content));
      }

      // Update message with actual WhatsApp message ID and status
      if (result?.messageId) {
        await prisma.message.update({
          where: { id: message.id },
          data: {
            messageId: result.messageId,
            status: 'sent',
          },
        });
      }

      this.logger.log(`Message sent successfully: ${result?.messageId}`);
      
      return {
        success: true,
        messageId: message.id,
        conversationId: conversation.id,
        waMessageId: result?.messageId,
        status: 'sent',
      };
    } catch (error: any) {
      this.logger.error(`Failed to send message: ${error.message}`);
      
      // Update message status to failed
      await prisma.message.update({
        where: { id: message.id },
        data: { status: 'failed' },
      });

      return {
        success: false,
        messageId: message.id,
        conversationId: conversation.id,
        status: 'failed',
        error: error.message,
      };
    }
  }

  // Normalize phone to JID
  private normalizeJid(to: string): string {
    // If already a valid JID (contains @), return as-is
    // This preserves @g.us for groups and @s.whatsapp.net for individuals
    if (to.includes('@')) {
      this.logger.debug(`JID already formatted: ${to}`);
      return to;
    }
    
    // Remove non-digit characters for phone number normalization
    let phone = to.replace(/\D/g, '');
    
    // Convert Indonesian local format (08xxx) to international (628xxx)
    if (phone.startsWith('0')) {
      phone = '62' + phone.slice(1);
    }
    
    const jid = `${phone}@s.whatsapp.net`;
    this.logger.debug(`Phone normalized to JID: ${to} -> ${jid}`);
    return jid;
  }

  // Generate vCard
  private generateVCard(contact: { name: string; phone: string; email?: string }): string {
    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${contact.name}`,
      `TEL;type=CELL;type=VOICE;waid=${contact.phone.replace(/\D/g, '')}:${contact.phone}`,
      contact.email ? `EMAIL:${contact.email}` : '',
      'END:VCARD',
    ].filter(Boolean).join('\n');
  }

  // Find messages by profile
  async findByProfile(profileId: string, options: { 
    limit?: number; 
    offset?: number;
    type?: string;
    direction?: string;
  }) {
    const where: any = { profileId };
    if (options.type) where.type = options.type;
    if (options.direction) where.direction = options.direction;

    return prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: options.limit || 50,
      skip: options.offset || 0,
      include: { conversation: true },
    });
  }

  // Find messages by conversation
  async findByConversation(conversationId: string, options: { limit?: number; before?: string }) {
    const where: any = { conversationId };
    
    if (options.before) {
      const beforeMsg = await prisma.message.findUnique({ 
        where: { id: options.before },
        select: { timestamp: true },
      });
      if (beforeMsg) {
        where.timestamp = { lt: beforeMsg.timestamp };
      }
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: options.limit || 50,
    });

    messages.reverse();
    return { messages, hasMore: messages.length === (options.limit || 50) };
  }

  // Get message by ID
  async findOne(id: string) {
    const message = await prisma.message.findUnique({ 
      where: { id },
      include: { conversation: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  // Delete message (from database only)
  async delete(id: string) {
    const message = await this.findOne(id);
    await prisma.message.delete({ where: { id } });
    return { success: true };
  }

  // ========== NEW FEATURES ==========

  // Send typing indicator
  async sendTyping(profileId: string, to: string, state: 'composing' | 'recording' | 'available' = 'composing', duration?: number) {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) throw new NotFoundException('Profile not connected');

    const jid = this.normalizeJid(to);
    await engine.sendPresenceUpdate(jid, state);

    // Note: We don't auto-clear typing. WhatsApp automatically clears
    // the typing indicator when a message is sent from the same account.
    // Auto-clearing was causing the typing to disappear before the message arrived.

    return { success: true, state, to: jid };
  }

  // Mark messages as read
  async markAsRead(profileId: string, chatId: string, messageIds?: string[]) {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) throw new NotFoundException('Profile not connected');

    const jid = this.normalizeJid(chatId);
    await engine.markAsRead(jid, messageIds);

    return { success: true, chatId: jid, messageIds };
  }

  // Delete message for everyone on WhatsApp
  async deleteForEveryone(profileId: string, chatId: string, messageId: string) {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) throw new NotFoundException('Profile not connected');

    const jid = this.normalizeJid(chatId);
    await engine.deleteForEveryone(jid, messageId);

    // Also update DB record if it exists
    try {
      const dbMessage = await prisma.message.findFirst({
        where: { messageId, profileId },
      });
      if (dbMessage) {
        await prisma.message.update({
          where: { id: dbMessage.id },
          data: { status: 'deleted' },
        });
      }
    } catch (e) {}

    return { success: true, chatId: jid, messageId };
  }

  // Schedule a message
  async scheduleMessage(profileId: string, to: string, type: string, content: any, scheduledAt: string) {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const scheduled = await prisma.scheduledMessage.create({
      data: {
        profileId,
        to,
        type,
        content,
        scheduledAt: scheduledDate,
      },
    });

    this.logger.log(`Scheduled message ${scheduled.id} for ${scheduledDate.toISOString()}`);
    return scheduled;
  }

  // Get scheduled messages
  async getScheduledMessages(profileId: string, status?: string) {
    return prisma.scheduledMessage.findMany({
      where: {
        profileId,
        ...(status ? { status } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  // Cancel scheduled message
  async cancelScheduledMessage(id: string) {
    const scheduled = await prisma.scheduledMessage.findUnique({ where: { id } });
    if (!scheduled) throw new NotFoundException('Scheduled message not found');
    if (scheduled.status !== 'pending') {
      throw new BadRequestException('Only pending messages can be cancelled');
    }

    return prisma.scheduledMessage.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}

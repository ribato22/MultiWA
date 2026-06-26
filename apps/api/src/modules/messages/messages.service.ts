// MultiWA Gateway - Enhanced Messages Service
// apps/api/src/modules/messages/messages.service.ts

import { Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus, Inject, forwardRef, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
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
import { SendGateService } from '@multiwa/engine-runtime';
import { AppEvents, isWhatsAppRecipient } from '@multiwa/core';
import {
  OUTBOUND_SEND_QUEUE,
  OUTBOUND_SEND_MAX_ATTEMPTS,
  OutboundSendJob,
  isDurableSend,
} from './outbound-send';
import { isWorkerEngine } from '../../common/engine-host';
import { EngineCommandsService } from '../engine-commands/engine-commands.service';


@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
    private readonly sendGate: SendGateService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(OUTBOUND_SEND_QUEUE)
    private readonly outboundQueue: Queue,
    // Engine commands client — drives worker-hosted engine ops (presence/read/
    // delete) when ENGINE_HOST=worker; idle when ENGINE_HOST=api.
    private readonly engineCommands: EngineCommandsService,
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

    // Worker-hosted engine OR durable mode: enqueue and return 202 immediately.
    // The consumer (in the worker when ENGINE_HOST=worker; in-API when
    // DURABLE_SEND=true) performs the real send through the send gate, so the send
    // survives a restart and gets bounded retry. In worker mode the API has no
    // engine of its own, so it must enqueue rather than check a local engine.
    if (isWorkerEngine() || isDurableSend()) {
      // Pre-enqueue daily-limit check so the common case still gets a synchronous
      // 429 (the send gate in the consumer is the authoritative increment).
      const now = new Date();
      const resetDue = !profile.dailyResetAt || profile.dailyResetAt <= now;
      if (
        profile.dailyMessageLimit != null &&
        !resetDue &&
        (profile.dailyMessageCount ?? 0) >= profile.dailyMessageLimit
      ) {
        await prisma.message.update({ where: { id: message.id }, data: { status: 'failed' } });
        throw new HttpException(
          {
            error: 'DAILY_LIMIT_REACHED',
            limit: profile.dailyMessageLimit,
            count: profile.dailyMessageCount,
            resetAt: profile.dailyResetAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await prisma.message.update({ where: { id: message.id }, data: { status: 'queued' } });
      const job: OutboundSendJob = { messageDbId: message.id, profileId, to: jid, type, content, quotedMessageId };
      await this.outboundQueue.add('send', job, {
        jobId: `send-${message.id}`,
        attempts: OUTBOUND_SEND_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      });

      return {
        success: true,
        messageId: message.id,
        conversationId: conversation.id,
        status: 'queued',
      };
    }

    // API-hosted synchronous send (ENGINE_HOST=api, DURABLE_SEND off).
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

    let result: any;
    try {
      result = await this.sendGate.executeWithGate(profileId, () =>
        this.dispatchToEngine(engine, type, jid, content, quotedMessageId),
      );
    } catch (error: any) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: 'failed' },
      });
      this.eventEmitter.emit(AppEvents.MESSAGE.FAILED, {
        profileId,
        messageId: message.id,
        to: jid,
        type,
        conversationId: conversation.id,
        error: error?.message,
      });
      // Daily-limit (429) and other HTTP errors propagate to the caller so the
      // API returns the real status code; engine send failures keep the existing
      // soft { success:false } contract.
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Failed to send message: ${error.message}`);
      return {
        success: false,
        messageId: message.id,
        conversationId: conversation.id,
        status: 'failed',
        error: error.message,
      };
    }

    // Update message with actual WhatsApp message ID and status
    if (result?.messageId) {
      await prisma.message.update({
        where: { id: message.id },
        data: { messageId: result.messageId, status: 'sent' },
      });
    }
    this.eventEmitter.emit(AppEvents.MESSAGE.SENT, {
      profileId,
      messageId: message.id,
      waMessageId: result?.messageId,
      to: jid,
      type,
      conversationId: conversation.id,
    });
    this.logger.log(`Message sent successfully: ${result?.messageId}`);
    return {
      success: true,
      messageId: message.id,
      conversationId: conversation.id,
      waMessageId: result?.messageId,
      status: 'sent',
    };
  }

  // Dispatch the actual engine call by message type. Rewrites media URLs so the
  // engine reaches MinIO over the Docker network (S3_PUBLIC_URL uses localhost
  // for browser access).
  private async dispatchToEngine(
    engine: any,
    type: string,
    jid: string,
    content: any,
    quotedMessageId?: string,
  ): Promise<any> {
    const engineContent = { ...content };
    if (engineContent.url && typeof engineContent.url === 'string') {
      engineContent.url = engineContent.url
        .replace('://localhost:9000', '://minio:9000')
        .replace('://127.0.0.1:9000', '://minio:9000');
    }
    switch (type) {
      case 'text':
        return engine.sendText(jid, engineContent.text, { quotedMessageId });
      case 'image':
        return engine.sendImage(jid, engineContent);
      case 'video':
        return engine.sendVideo(jid, engineContent);
      case 'audio':
        return engine.sendAudio(jid, engineContent);
      case 'document':
        return engine.sendDocument(jid, engineContent);
      case 'location':
        return engine.sendLocation(jid, content);
      case 'contact':
        return engine.sendContact(jid, content);
      case 'poll':
        return engine.sendPoll(jid, content);
      case 'reaction':
        return engine.sendReaction(content.messageId, content.emoji);
      default:
        this.logger.warn(`Unknown message type: ${type}`);
        return engine.sendText(jid, JSON.stringify(content));
    }
  }

  /**
   * Deliver one queued outbound send (called by OutboundSendConsumer in the
   * durable path). Runs through the send gate exactly like the synchronous path.
   * - transient errors (or a not-yet-connected profile) throw so BullMQ retries;
   *   on the last attempt the message is marked failed instead.
   * - a daily-limit 429 is permanent: the message is marked failed without retry.
   */
  async deliverQueued(data: OutboundSendJob, isLastAttempt: boolean): Promise<void> {
    const { messageDbId, profileId, to, type, content, quotedMessageId } = data;

    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      if (isLastAttempt) {
        await this.markQueuedFailed(messageDbId, profileId, to, type, 'Profile not connected');
        return;
      }
      throw new Error(`Profile ${profileId} not connected; retrying queued send`);
    }

    try {
      const result = await this.sendGate.executeWithGate(profileId, () =>
        this.dispatchToEngine(engine, type, to, content, quotedMessageId),
      );
      await prisma.message.update({
        where: { id: messageDbId },
        data: { ...(result?.messageId ? { messageId: result.messageId } : {}), status: 'sent' },
      });
      this.eventEmitter.emit(AppEvents.MESSAGE.SENT, {
        profileId,
        messageId: messageDbId,
        waMessageId: result?.messageId,
        to,
        type,
      });
    } catch (error: any) {
      // Daily-limit rejection is permanent for today — fail without retry.
      if (error instanceof HttpException && error.getStatus?.() === HttpStatus.TOO_MANY_REQUESTS) {
        await this.markQueuedFailed(messageDbId, profileId, to, type, 'DAILY_LIMIT_REACHED');
        return;
      }
      if (isLastAttempt) {
        await this.markQueuedFailed(messageDbId, profileId, to, type, error?.message);
        return;
      }
      throw error; // transient: let BullMQ retry with backoff
    }
  }

  private async markQueuedFailed(
    messageId: string,
    profileId: string,
    to: string,
    type: string,
    errorMsg?: string,
  ): Promise<void> {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } });
    this.eventEmitter.emit(AppEvents.MESSAGE.FAILED, {
      profileId,
      messageId,
      to,
      type,
      error: errorMsg,
    });
  }

  // Normalize phone to JID
  private normalizeJid(to: string): string {
    // Defense-in-depth: the DTO @IsWhatsAppRecipient gate only runs in the HTTP
    // ValidationPipe. Internal callers (automation rule-engine, AI actions) reach
    // here with a raw `to`, so re-validate with the same shared predicate to keep
    // junk out of the engine + DB. Trim first so leading/trailing whitespace (the
    // validator tolerates it) does not leak into the stored JID.
    const input = typeof to === 'string' ? to.trim() : to;
    if (!isWhatsAppRecipient(input)) {
      throw new BadRequestException(`Invalid recipient: ${to}`);
    }

    // If already a valid JID (contains @), return as-is
    // This preserves @g.us for groups and @s.whatsapp.net for individuals
    if (input.includes('@')) {
      this.logger.debug(`JID already formatted: ${input}`);
      return input;
    }

    // Remove non-digit characters for phone number normalization
    let phone = input.replace(/\D/g, '');
    
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

  /**
   * On-demand "load older": pull up to `limit` most-recent messages for a
   * conversation directly from WhatsApp, persist any not yet in the DB (deduped,
   * system-types filtered), then return the refreshed DB page. Increasing `limit`
   * across calls walks further back in history. Requires the profile's engine to
   * be connected; otherwise returns the current DB page unchanged.
   */
  async loadOlderMessages(conversationId: string, limit: number) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const profileId = conversation.profileId;
    const cap = Math.max(1, Math.min(limit || 100, 500));

    const engine = this.engineManager.getEngine(profileId) as any;
    if (!engine?.fetchChatMessages || !engine.isReady?.()) {
      const current = await this.findByConversation(conversationId, { limit: cap });
      return { synced: 0, engineReady: false, ...current };
    }

    const isGroup = conversation.type === 'group' || conversation.jid.includes('@g.us');
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { phoneNumber: true } });
    const selfDigits = (profile?.phoneNumber || '').replace(/\D/g, '');
    const selfJid = selfDigits ? `${selfDigits}@s.whatsapp.net` : '';

    let synced = 0;
    try {
      const fetched = await engine.fetchChatMessages(conversation.jid, cap);
      for (const m of fetched || []) {
        const msgType: string = m?.type || 'chat';
        if (EngineManagerService.SYSTEM_MESSAGE_TYPES.has(msgType)) continue;
        const messageId: string = m?.id || '';
        if (!messageId) continue;
        const exists = await prisma.message.findFirst({ where: { profileId, messageId }, select: { id: true } });
        if (exists) continue;

        const content: Record<string, any> = {};
        if (m.body) content.text = m.body;
        if (m.hasMedia) content.hasMedia = true;
        const fromMe = !!m.fromMe;
        const senderJid = fromMe
          ? (selfJid || conversation.jid)
          : (isGroup ? (m.author || m.from || conversation.jid) : conversation.jid);
        const t = Number(m.timestamp);
        const ms = t > 10_000_000_000 ? t : t * 1000;
        let ts = new Date(ms);
        if (isNaN(ts.getTime()) || ts.getFullYear() > 2100 || ts.getFullYear() < 2000) ts = new Date();

        await prisma.message.create({
          data: {
            profileId, conversationId, messageId,
            direction: fromMe ? 'outgoing' : 'incoming',
            senderJid, type: msgType === 'chat' ? 'text' : msgType,
            content, status: fromMe ? 'sent' : 'received', timestamp: ts,
          },
        });
        synced++;
      }
    } catch (err) {
      this.logger.warn(`loadOlderMessages: fetch failed for ${conversationId}: ${(err as Error).message}`);
    }

    const refreshed = await this.findByConversation(conversationId, { limit: cap });
    return { synced, engineReady: true, ...refreshed };
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
    const jid = this.normalizeJid(to);

    if (isWorkerEngine()) {
      await this.engineCommands.presenceUpdate(profileId, jid, state);
      return { success: true, state, to: jid };
    }

    const engine = this.engineManager.getEngine(profileId);
    if (!engine) throw new NotFoundException('Profile not connected');
    await engine.sendPresenceUpdate(jid, state);

    // Note: We don't auto-clear typing. WhatsApp automatically clears
    // the typing indicator when a message is sent from the same account.
    // Auto-clearing was causing the typing to disappear before the message arrived.

    return { success: true, state, to: jid };
  }

  // Mark messages as read
  async markAsRead(profileId: string, chatId: string, messageIds?: string[]) {
    const jid = this.normalizeJid(chatId);

    if (isWorkerEngine()) {
      await this.engineCommands.markRead(profileId, jid, messageIds);
      return { success: true, chatId: jid, messageIds };
    }

    const engine = this.engineManager.getEngine(profileId);
    if (!engine) throw new NotFoundException('Profile not connected');
    await engine.markAsRead(jid, messageIds);

    return { success: true, chatId: jid, messageIds };
  }

  // Delete message for everyone on WhatsApp
  async deleteForEveryone(profileId: string, chatId: string, messageId: string) {
    const jid = this.normalizeJid(chatId);

    if (isWorkerEngine()) {
      await this.engineCommands.deleteForEveryone(profileId, jid, messageId);
    } else {
      const engine = this.engineManager.getEngine(profileId);
      if (!engine) throw new NotFoundException('Profile not connected');
      await engine.deleteForEveryone(jid, messageId);
    }

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

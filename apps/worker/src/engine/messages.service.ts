// MultiWA Gateway - Worker messages (send path)
// apps/worker/src/engine/messages.service.ts
//
// Worker-local message sender: in-process send* (for automation replies) and
// deliverQueued (for the outbound-send queue). Persist + per-profile send gate +
// engine dispatch + message.sent/failed bus events. Worker-local copy of the
// API MessagesService send path; keep in sync.

import { Injectable, Logger, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { SendGateService, classifyColdSend, repeatDedupeText } from '@multiwa/engine-runtime';
import { AppEvents, isWhatsAppRecipient } from '@multiwa/core';
import { EngineManagerService } from './engine-manager.service';

export interface OutboundSendJob {
  messageDbId: string;
  profileId: string;
  to: string;
  type: string;
  content: any;
  quotedMessageId?: string;
}

@Injectable()
export class WorkerMessagesService {
  private readonly logger = new Logger(WorkerMessagesService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
    private readonly sendGate: SendGateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // --- send* wrappers (used by the rule engine for automation replies) ---
  sendText(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'text', { text: dto.text }, dto.quotedMessageId); }
  sendImage(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'image', { url: dto.url, base64: dto.base64, caption: dto.caption, mimetype: dto.mimetype || 'image/jpeg' }); }
  sendVideo(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'video', { url: dto.url, base64: dto.base64, caption: dto.caption, mimetype: dto.mimetype || 'video/mp4' }); }
  sendAudio(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'audio', { url: dto.url, base64: dto.base64, mimetype: dto.mimetype || 'audio/mpeg', ptt: dto.ptt || false }); }
  sendDocument(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'document', { url: dto.url, base64: dto.base64, filename: dto.filename, caption: dto.caption, mimetype: dto.mimetype || 'application/octet-stream' }); }
  sendLocation(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'location', { latitude: dto.latitude, longitude: dto.longitude, name: dto.name, address: dto.address }); }
  sendContact(dto: any) {
    return this.queueMessage(dto.profileId, dto.to, 'contact', {
      contacts: (dto.contacts || []).map((c: any) => ({ displayName: c.name, vcard: this.generateVCard(c) })),
      name: dto.contacts?.[0]?.name,
      phone: dto.contacts?.[0]?.phone,
    });
  }
  sendPoll(dto: any) { return this.queueMessage(dto.profileId, dto.to, 'poll', { question: dto.question, options: dto.options, allowMultipleAnswers: dto.allowMultipleAnswers || false }); }

  // In-process send: persist + gate + dispatch + emit.
  private async queueMessage(profileId: string, to: string, type: string, content: any, quotedMessageId?: string) {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    if (!profile) return { success: false, error: 'Profile not found' };

    // Defense-in-depth: automation/rule-engine replies reach here with a raw `to`
    // and bypass the API DTO gate. Reject junk before it becomes a bad JID + a
    // junk conversation. Shared predicate keeps this in sync with the API gate.
    if (!isWhatsAppRecipient(to)) {
      return { success: false, error: `Invalid recipient: ${to}` };
    }

    const jid = this.normalizeJid(to);

    let conversation = await prisma.conversation.findFirst({ where: { profileId, jid } });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { profileId, jid, name: to, type: jid.includes('@g.us') ? 'group' : 'user' },
      });
    }

    // Classify the send lane once (service reply vs cold) and persist it.
    const isCold = await classifyColdSend(profileId, jid, (profile as any).serviceWindowHours ?? 24);

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
        lane: isCold ? 'cold' : 'service',
        timestamp: new Date(),
        quotedMessageId,
      },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      return { success: true, messageId: message.id, conversationId: conversation.id, status: 'pending', warning: 'Profile not connected' };
    }

    try {
      const result = await this.sendGate.executeWithGate(
        profileId,
        () => this.dispatchToEngine(engine, type, jid, content, quotedMessageId),
        jid,
        isCold,
        repeatDedupeText(type, content),
      );
      if (result?.messageId) {
        await prisma.message.update({ where: { id: message.id }, data: { messageId: result.messageId, status: 'sent' } });
      }
      this.eventEmitter.emit(AppEvents.MESSAGE.SENT, { profileId, messageId: message.id, waMessageId: result?.messageId, to: jid, type, conversationId: conversation.id });
      return { success: true, messageId: message.id, conversationId: conversation.id, waMessageId: result?.messageId, status: 'sent' };
    } catch (error: any) {
      await prisma.message.update({ where: { id: message.id }, data: { status: 'failed' } });
      this.eventEmitter.emit(AppEvents.MESSAGE.FAILED, { profileId, messageId: message.id, to: jid, type, error: error?.message });
      return { success: false, messageId: message.id, conversationId: conversation.id, status: 'failed', error: error?.message };
    }
  }

  // Deliver a queued outbound send (drained by the outbound-send worker).
  async deliverQueued(data: OutboundSendJob, isLastAttempt: boolean): Promise<void> {
    const { messageDbId, profileId, to, type, content, quotedMessageId } = data;
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      if (isLastAttempt) {
        await this.markFailed(messageDbId, profileId, to, type, 'Profile not connected');
        return;
      }
      throw new Error(`Profile ${profileId} not connected; retrying queued send`);
    }
    // Reuse the lane persisted at enqueue so gate governance matches the stored lane.
    const laneRow = await prisma.message.findUnique({ where: { id: messageDbId }, select: { lane: true } });
    try {
      const result = await this.sendGate.executeWithGate(
        profileId,
        () => this.dispatchToEngine(engine, type, to, content, quotedMessageId),
        to,
        laneRow?.lane === 'cold',
        repeatDedupeText(type, content),
      );
      await prisma.message.update({
        where: { id: messageDbId },
        data: { ...(result?.messageId ? { messageId: result.messageId } : {}), status: 'sent' },
      });
      this.eventEmitter.emit(AppEvents.MESSAGE.SENT, { profileId, messageId: messageDbId, waMessageId: result?.messageId, to, type });
    } catch (error: any) {
      if (error instanceof HttpException && error.getStatus?.() === HttpStatus.TOO_MANY_REQUESTS) {
        await this.markFailed(messageDbId, profileId, to, type, 'DAILY_LIMIT_REACHED');
        return;
      }
      if (isLastAttempt) {
        await this.markFailed(messageDbId, profileId, to, type, error?.message);
        return;
      }
      throw error;
    }
  }

  private async markFailed(messageId: string, profileId: string, to: string, type: string, errorMsg?: string): Promise<void> {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } });
    this.eventEmitter.emit(AppEvents.MESSAGE.FAILED, { profileId, messageId, to, type, error: errorMsg });
  }

  private async dispatchToEngine(engine: any, type: string, jid: string, content: any, quotedMessageId?: string): Promise<any> {
    const engineContent = { ...content };
    if (engineContent.url && typeof engineContent.url === 'string') {
      engineContent.url = engineContent.url.replace('://localhost:9000', '://minio:9000').replace('://127.0.0.1:9000', '://minio:9000');
    }
    switch (type) {
      case 'text': return engine.sendText(jid, engineContent.text, { quotedMessageId });
      case 'image': return engine.sendImage(jid, engineContent);
      case 'video': return engine.sendVideo(jid, engineContent);
      case 'audio': return engine.sendAudio(jid, engineContent);
      case 'document': return engine.sendDocument(jid, engineContent);
      case 'location': return engine.sendLocation(jid, content);
      case 'contact': return engine.sendContact(jid, content);
      case 'poll': return engine.sendPoll(jid, content);
      case 'reaction': return engine.sendReaction(content.messageId, content.emoji);
      default: return engine.sendText(jid, JSON.stringify(content));
    }
  }

  // Recipient is validated in queueMessage (the only caller) via isWhatsAppRecipient.
  // Trim so leading/trailing whitespace does not leak into the stored JID.
  private normalizeJid(to: string): string {
    const input = to.trim();
    if (input.includes('@')) return input;
    let phone = input.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '62' + phone.slice(1);
    return `${phone}@s.whatsapp.net`;
  }

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
}

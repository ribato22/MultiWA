// MultiWA Gateway - Worker send path
// apps/worker/src/engine/sender.service.ts
//
// Drains an outbound-send job through the per-profile send gate and the
// worker-hosted engine. Mirrors the API MessagesService.deliverQueued contract.

import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { SendGateService } from '@multiwa/engine-runtime';
import { AppEvents } from '@multiwa/core';
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
export class WorkerSenderService {
  private readonly logger = new Logger(WorkerSenderService.name);

  constructor(
    private readonly engineManager: EngineManagerService,
    private readonly sendGate: SendGateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async deliver(data: OutboundSendJob, isLastAttempt: boolean): Promise<void> {
    const { messageDbId, profileId, to, type, content, quotedMessageId } = data;

    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      if (isLastAttempt) {
        await this.markFailed(messageDbId, profileId, to, type, 'Profile not connected');
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
      if (error instanceof HttpException && error.getStatus?.() === HttpStatus.TOO_MANY_REQUESTS) {
        await this.markFailed(messageDbId, profileId, to, type, 'DAILY_LIMIT_REACHED');
        return;
      }
      if (isLastAttempt) {
        await this.markFailed(messageDbId, profileId, to, type, error?.message);
        return;
      }
      throw error; // transient: BullMQ retries
    }
  }

  private async markFailed(messageId: string, profileId: string, to: string, type: string, errorMsg?: string): Promise<void> {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } });
    this.eventEmitter.emit(AppEvents.MESSAGE.FAILED, { profileId, messageId, to, type, error: errorMsg });
  }

  // Dispatch by message type. Rewrites media URLs for the Docker network (mirrors
  // the API MessagesService.dispatchToEngine).
  private async dispatchToEngine(engine: any, type: string, jid: string, content: any, quotedMessageId?: string): Promise<any> {
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
}

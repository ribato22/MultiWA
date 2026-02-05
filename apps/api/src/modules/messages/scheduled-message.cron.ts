// MultiWA Gateway - Scheduled Message Cron Job
// apps/api/src/modules/messages/scheduled-message.cron.ts

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';

@Injectable()
export class ScheduledMessageCron {
  private readonly logger = new Logger(ScheduledMessageCron.name);

  constructor(
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
  ) {}

  /**
   * Runs every 30 seconds to check for scheduled messages that need to be sent.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processScheduledMessages() {
    try {
      const now = new Date();
      const pendingMessages = await prisma.scheduledMessage.findMany({
        where: {
          status: 'pending',
          scheduledAt: { lte: now },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10, // Process in batches of 10
      });

      if (pendingMessages.length === 0) return;

      this.logger.log(`Processing ${pendingMessages.length} scheduled message(s)...`);

      for (const scheduled of pendingMessages) {
        try {
          // Send the message using the appropriate method
          const content = scheduled.content as any;
          
          switch (scheduled.type) {
            case 'text':
              await this.messagesService.sendText({
                profileId: scheduled.profileId,
                to: scheduled.to,
                text: content.text || content,
              });
              break;
            case 'image':
              await this.messagesService.sendImage({
                profileId: scheduled.profileId,
                to: scheduled.to,
                url: content.url,
                base64: content.base64,
                caption: content.caption,
                mimetype: content.mimetype,
              });
              break;
            case 'video':
              await this.messagesService.sendVideo({
                profileId: scheduled.profileId,
                to: scheduled.to,
                url: content.url,
                base64: content.base64,
                caption: content.caption,
                mimetype: content.mimetype,
              });
              break;
            case 'audio':
              await this.messagesService.sendAudio({
                profileId: scheduled.profileId,
                to: scheduled.to,
                url: content.url,
                base64: content.base64,
                mimetype: content.mimetype,
              });
              break;
            case 'document':
              await this.messagesService.sendDocument({
                profileId: scheduled.profileId,
                to: scheduled.to,
                url: content.url,
                base64: content.base64,
                filename: content.filename || 'document',
                caption: content.caption,
                mimetype: content.mimetype,
              });
              break;
            default:
              throw new Error(`Unsupported message type: ${scheduled.type}`);
          }

          // Mark as sent
          await prisma.scheduledMessage.update({
            where: { id: scheduled.id },
            data: { status: 'sent', sentAt: new Date() },
          });

          this.logger.log(`✓ Scheduled message ${scheduled.id} sent successfully`);
        } catch (error: any) {
          this.logger.error(`✗ Failed to send scheduled message ${scheduled.id}: ${error.message}`);
          
          // Mark as failed
          await prisma.scheduledMessage.update({
            where: { id: scheduled.id },
            data: { status: 'failed', error: error.message },
          });
        }
      }
    } catch (error: any) {
      this.logger.error(`Scheduled message cron error: ${error.message}`);
    }
  }
}

// apps/worker/src/processors/scheduled.processor.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';

const prisma = new PrismaClient();
const logger = pino({ name: 'scheduled-processor' });

export class ScheduledProcessor {
  /**
   * Process scheduled message check job
   * This runs periodically to find and send due messages
   */
  async process(job: Job) {
    const { profileId } = job.data || {};

    logger.info({ profileId }, 'Processing scheduled messages');

    const now = new Date();

    // Find pending messages that are due
    const pendingMessages = await prisma.scheduledMessage.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
        ...(profileId && { profileId }),
      },
      take: 50, // Process in batches
      orderBy: { scheduledAt: 'asc' },
    });

    logger.info({ count: pendingMessages.length }, 'Found pending scheduled messages');

    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
    };

    for (const msg of pendingMessages) {
      results.processed++;

      try {
        // Get profile for sending
        const profile = await prisma.profile.findUnique({
          where: { id: msg.profileId },
        });

        if (!profile || profile.status !== 'CONNECTED') {
          logger.warn({ messageId: msg.id, profileId: msg.profileId }, 'Profile not connected, skipping');
          continue;
        }

        // Find or create contact using the 'to' field (phone/JID)
        const phone = msg.to.replace(/@.*$/, ''); // Strip JID suffix if present
        let contact = await prisma.contact.findUnique({
          where: {
            profileId_phone: {
              profileId: msg.profileId,
              phone,
            },
          },
        });

        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              profileId: msg.profileId,
              phone,
            },
          });
        }

        // Find or create conversation using the JID-based unique constraint
        const jid = msg.to.includes('@') ? msg.to : `${msg.to}@s.whatsapp.net`;
        let conversation = await prisma.conversation.findUnique({
          where: {
            profileId_jid: {
              profileId: msg.profileId,
              jid,
            },
          },
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              profileId: msg.profileId,
              contactId: contact.id,
              jid,
            },
          });
        }

        // Create message record with all required fields
        const message = await prisma.message.create({
          data: {
            profileId: msg.profileId,
            conversationId: conversation.id,
            messageId: `scheduled_${msg.id}_${Date.now()}`,
            direction: 'outgoing',
            senderJid: 'self',
            type: msg.type,
            content: msg.content as any,
            status: 'pending',
            timestamp: new Date(),
          },
        });

        // Mark scheduled message as sent
        await prisma.scheduledMessage.update({
          where: { id: msg.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
          },
        });

        results.sent++;
        logger.info({ messageId: msg.id, to: msg.to }, 'Scheduled message sent');

      } catch (error: any) {
        results.failed++;
        logger.error({ messageId: msg.id, error: error.message }, 'Failed to send scheduled message');

        // Mark as failed
        await prisma.scheduledMessage.update({
          where: { id: msg.id },
          data: {
            status: 'failed',
            error: error.message,
          },
        });
      }
    }

    return results;
  }
}

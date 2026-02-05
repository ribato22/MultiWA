// apps/worker/src/processors/message.processor.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface MessageJob {
  profileId: string;
  messageId: string;
  to: string;
  type: string;
  content: any;
}

export class MessageProcessor {
  async process(job: Job<MessageJob>) {
    const { profileId, messageId, to, type, content } = job.data;

    try {
      // Get profile
      const profile = await prisma.profile.findUnique({
        where: { id: profileId },
      });

      if (!profile || profile.status !== 'CONNECTED') {
        throw new Error('Profile not connected');
      }

      // Note: Actual sending is handled by API gateway via websocket
      // Worker just updates status and logs

      // Update message status to QUEUED for gateway to process
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'QUEUED',
        },
      });

      return {
        success: true,
        profileId,
        messageId,
        to,
        type,
        status: 'queued_for_gateway'
      };
    } catch (error) {
      // Update message status to failed — use metadata for error detail
      // since Message model doesn't have an errorMessage field
      await prisma.message.update({
        where: { id: messageId },
        data: {
          status: 'FAILED',
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
        },
      });

      throw error;
    }
  }
}

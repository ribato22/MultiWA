// apps/worker/src/processors/scheduled.processor.ts
import { Job } from 'bullmq';
import pino from 'pino';

const logger = pino({ name: 'scheduled-processor' });

export class ScheduledProcessor {
  /**
   * Scheduled message delivery is owned by the API process, which holds the live
   * WhatsApp engine sessions:
   * apps/api/src/modules/messages/scheduled-message.cron.ts runs every 30s and
   * actually sends due messages through MessagesService.
   *
   * This worker has no engine sessions, so it could only mark messages "sent"
   * without delivering them — and racing the API cron would cause messages to be
   * flagged sent and then never delivered. It is therefore a deliberate no-op.
   * (Durable async sending via a real queue is tracked under the send-gate work.)
   */
  async process(_job: Job) {
    logger.debug('scheduled queue tick ignored — delivery handled by the API scheduled-message cron');
    return { skipped: true, reason: 'handled by API scheduled-message cron' };
  }
}

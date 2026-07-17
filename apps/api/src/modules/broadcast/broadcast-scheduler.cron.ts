// MultiWA Gateway - Broadcast Scheduler Cron Job
// apps/api/src/modules/broadcast/broadcast-scheduler.cron.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { prisma } from '@multiwa/database';
import { BroadcastService } from './broadcast.service';

@Injectable()
export class BroadcastSchedulerCron {
  private readonly logger = new Logger(BroadcastSchedulerCron.name);

  constructor(private readonly broadcastService: BroadcastService) {}

  /**
   * Every 30s, launch any scheduled broadcast whose scheduledAt has arrived. Each
   * launch goes through BroadcastService.startScheduled(), whose atomic claim ensures
   * overlapping ticks (or a manual start) can never double-start the same broadcast.
   * Runs only in the API process (ScheduleModule is registered in the API AppModule).
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processScheduledBroadcasts() {
    try {
      const due = await prisma.broadcast.findMany({
        where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
        orderBy: { scheduledAt: 'asc' },
        take: 10, // Process in batches; the next tick picks up the rest.
        select: { id: true },
      });
      if (due.length === 0) return;

      this.logger.log(`Launching ${due.length} due scheduled broadcast(s)...`);
      for (const { id } of due) {
        try {
          await this.broadcastService.startScheduled(id);
        } catch (err: any) {
          this.logger.error(`Failed to launch scheduled broadcast ${id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Scheduled broadcast cron error: ${err.message}`);
    }
  }
}

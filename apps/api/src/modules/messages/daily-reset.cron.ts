// MultiWA Gateway - Daily Send-Counter Reset Cron
// apps/api/src/modules/messages/daily-reset.cron.ts
//
// Deterministic per-profile daily counter reset at 00:00 WIB. The explicit
// timeZone option makes the container TZ irrelevant. SendGateService also resets
// lazily on the same WIB boundary as defense-in-depth for missed cron runs.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { prisma } from '@multiwa/database';
import { nextMidnightWIB } from '@multiwa/engine-runtime';

@Injectable()
export class DailyResetCron {
  private readonly logger = new Logger(DailyResetCron.name);

  @Cron('0 0 * * *', { timeZone: 'Asia/Jakarta' })
  async handleReset(): Promise<void> {
    const resetAt = nextMidnightWIB(new Date());
    const res = await prisma.profile.updateMany({
      data: { dailyMessageCount: 0, coldMessageCount: 0, dailyResetAt: resetAt },
    });
    this.logger.log(
      `Daily message counters reset for ${res.count} profile(s); next reset ${resetAt.toISOString()}`,
    );
  }
}

// MultiWA Gateway - Send Gate Service
// apps/api/src/modules/messages/send-gate.service.ts
//
// Enforces per-profile outbound pacing (messageDelayMs, block-and-wait) and the
// per-profile daily send cap (dailyMessageLimit, reject 429) for EVERY outbound
// send path. See architecture/send-gate-sop.md.

import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { prisma } from '@multiwa/database';

/** WIB (Asia/Jakarta) is a fixed UTC+7 offset with no DST. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * The next 00:00 WIB after `from`, returned as the equivalent UTC instant.
 * Shared by SendGateService's lazy reset and DailyResetCron so both reset on the
 * same boundary (never server-local midnight).
 */
export function nextMidnightWIB(from: Date): Date {
  const wibNow = new Date(from.getTime() + WIB_OFFSET_MS);
  const wibNextMidnight = Date.UTC(
    wibNow.getUTCFullYear(),
    wibNow.getUTCMonth(),
    wibNow.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return new Date(wibNextMidnight - WIB_OFFSET_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class SendGateService {
  private readonly logger = new Logger(SendGateService.name);

  // Per-profile serial chain (in-process mutex). The STORED tail always resolves
  // so one failure/429 never wedges the profile's queue; the caller-facing
  // promise carries the real result/error. Single-instance only (see SOP).
  private readonly profileChains = new Map<string, Promise<unknown>>();
  private readonly lastSentAt = new Map<string, number>();

  /**
   * Serialize the send for this profile, apply the inter-message delay, enforce
   * the daily limit (429 when reached), run sendFn, and increment the daily
   * counter on success. Returns sendFn's result, or rejects with the send error
   * / a 429 HttpException.
   */
  async executeWithGate<T>(profileId: string, sendFn: () => Promise<T>): Promise<T> {
    const prev = this.profileChains.get(profileId) ?? Promise.resolve();
    // Run after the previous send for this profile, whether it resolved or rejected.
    const runResult = prev.then(
      () => this.gatedRun(profileId, sendFn),
      () => this.gatedRun(profileId, sendFn),
    );
    // The stored tail must never reject (or it poisons the chain).
    this.profileChains.set(
      profileId,
      runResult.then(
        () => undefined,
        () => undefined,
      ),
    );
    return runResult;
  }

  private async gatedRun<T>(profileId: string, sendFn: () => Promise<T>): Promise<T> {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        messageDelayMs: true,
        dailyMessageLimit: true,
        dailyMessageCount: true,
        dailyResetAt: true,
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    // 1. Inter-message delay (block-and-wait).
    const delayMs = profile.messageDelayMs ?? 1500;
    const last = this.lastSentAt.get(profileId) ?? 0;
    const wait = Math.max(0, delayMs - (Date.now() - last));
    if (wait > 0) await sleep(wait);
    // Record the attempt time now so a burst of failures/429s cannot collapse the
    // inter-message spacing.
    this.lastSentAt.set(profileId, Date.now());

    // 2. Lazy daily reset (WIB boundary) + limit check.
    const now = new Date();
    let count = profile.dailyMessageCount ?? 0;
    if (!profile.dailyResetAt || profile.dailyResetAt <= now) {
      count = 0;
      await prisma.profile.update({
        where: { id: profileId },
        data: { dailyMessageCount: 0, dailyResetAt: nextMidnightWIB(now) },
      });
    }
    const limit = profile.dailyMessageLimit;
    // null/undefined limit means unlimited.
    if (limit != null && count >= limit) {
      throw new HttpException(
        {
          error: 'DAILY_LIMIT_REACHED',
          limit,
          count,
          resetAt: profile.dailyResetAt ?? nextMidnightWIB(now),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 3. Send, then increment the counter only on a real successful send.
    const result = await sendFn();
    await prisma.profile.update({
      where: { id: profileId },
      data: { dailyMessageCount: { increment: 1 } },
    });
    return result;
  }
}

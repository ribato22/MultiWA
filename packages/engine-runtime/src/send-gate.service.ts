// MultiWA Gateway - Send Gate Service (shared engine runtime)
// packages/engine-runtime/src/send-gate.service.ts
//
// Enforces per-profile outbound pacing (messageDelayMs, block-and-wait) and the
// per-profile daily send cap (dailyMessageLimit, reject 429) for EVERY outbound
// send path. Shared by apps/api (ENGINE_HOST=api) and apps/worker
// (ENGINE_HOST=worker). See architecture/send-gate-sop.md.

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
const DAY_MS = 24 * 60 * 60 * 1000;

/** Integer index of the WIB calendar day containing `d` (same boundary as the daily reset). */
function wibDayNumber(d: Date): number {
  return Math.floor((d.getTime() + WIB_OFFSET_MS) / DAY_MS);
}

/** Minimal profile shape the warm-up cap needs (subset of the Prisma Profile row). */
export interface WarmupCapInput {
  dailyMessageLimit?: number | null;
  warmupEnabled?: boolean | null;
  warmupStartPerDay?: number | null;
  warmupRampDays?: number | null;
  warmupStartedAt?: Date | null;
}

/**
 * Effective daily send cap for a profile at instant `now`, accounting for the
 * warm-up ramp. Returns null when unlimited.
 *
 * When warm-up is enabled AND a daily limit (the ramp target) is set, the cap
 * climbs linearly from warmupStartPerDay up to dailyMessageLimit over
 * warmupRampDays WIB days, anchored at warmupStartedAt. Day 0 is the WIB day of
 * the anchor. Missing/invalid warm-up config falls back to the plain daily limit
 * (no surprise cap). Warm-up with an unlimited target is a no-op (needs a target).
 * The result never exceeds the hard daily limit and never goes below 0.
 */
export function effectiveDailyCap(profile: WarmupCapInput, now: Date = new Date()): number | null {
  const hardLimit = profile.dailyMessageLimit ?? null;
  if (!profile.warmupEnabled) return hardLimit;
  // Warm-up ramps toward the daily limit; with no numeric target there is nothing
  // to ramp to, so leave it unlimited.
  if (hardLimit == null) return null;

  const start = profile.warmupStartPerDay;
  const rampDays = profile.warmupRampDays;
  const startedAt = profile.warmupStartedAt;
  if (start == null || rampDays == null || rampDays < 1 || !startedAt) return hardLimit;

  const dayIndex = wibDayNumber(now) - wibDayNumber(startedAt);
  // Day 0 (and any future anchor) is exactly the start cap. This also makes a
  // 1-day ramp behave sanely: day 0 = start, day 1+ = full limit.
  if (dayIndex <= 0) return Math.max(0, Math.min(hardLimit, start));
  if (dayIndex >= rampDays - 1) return hardLimit; // ramp complete

  const progress = dayIndex / Math.max(1, rampDays - 1);
  const capped = Math.round(start + (hardLimit - start) * progress);
  return Math.max(0, Math.min(hardLimit, capped));
}

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

/** Default cold-lane daily cap when neither coldDailyLimit nor dailyMessageLimit is set. */
const COLD_DEFAULT_DAILY_LIMIT = Number(process.env.COLD_DEFAULT_DAILY_LIMIT) || 250;

/**
 * Classify an outbound send as "cold" (business-initiated) vs "service" (reply).
 *
 * A send is a SERVICE reply when the recipient messaged this profile within
 * serviceWindowHours (WhatsApp's customer-service window) — those are not subject
 * to the reach-out lock and must flow freely. Everything else to a person is COLD
 * (first contact / outside the window: OTP, notifications, marketing). Group,
 * broadcast and newsletter sends are never cold outreach. A missing recipient
 * defaults to service so we never block a send we cannot classify.
 */
export async function classifyColdSend(
  profileId: string,
  recipient: string | undefined,
  serviceWindowHours: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (!recipient) return false;
  const jid = recipient.replace(/@c\.us$/, '@s.whatsapp.net');
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return false;
  const since = new Date(now.getTime() - Math.max(0, serviceWindowHours) * 60 * 60 * 1000);

  // A contact can be stored under either its phone JID or its hidden @lid form
  // (multi-device). Gather every linked JID so an in-window reply persisted under
  // the alternate form still matches. (Truly unresolved @lid inbound with no
  // stored link can't be connected without the live engine — a known limitation.)
  const candidates = new Set<string>([jid]);
  const linked = await prisma.conversation.findMany({
    where: { profileId, OR: [{ jid }, { metadata: { path: ['lidJid'], equals: jid } }] },
    select: { jid: true, metadata: true },
  });
  for (const c of linked) {
    candidates.add(c.jid);
    const lid = (c.metadata as any)?.lidJid;
    if (typeof lid === 'string' && lid) candidates.add(lid);
  }

  const lastInbound = await prisma.message.findFirst({
    where: {
      profileId,
      direction: 'incoming',
      conversation: { is: { profileId, jid: { in: [...candidates] } } },
    },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  return !lastInbound || lastInbound.timestamp < since;
}

/** Fields the lane cap resolver reads (superset of WarmupCapInput). */
export type LaneCapInput = WarmupCapInput & { coldDailyLimit?: number | null };

/**
 * Effective daily cap for a lane. Replies (service) only hit the plain daily
 * backstop with no warm-up throttling; cold sends hit the cold cap
 * (coldDailyLimit → dailyMessageLimit → the conservative default), ramped by the
 * warm-up schedule. Null means uncapped.
 */
export function effectiveCapForLane(profile: LaneCapInput, isCold: boolean, now: Date = new Date()): number | null {
  if (!isCold) return profile.dailyMessageLimit ?? null;
  const baseColdLimit = profile.coldDailyLimit ?? profile.dailyMessageLimit ?? COLD_DEFAULT_DAILY_LIMIT;
  return effectiveDailyCap({ ...profile, dailyMessageLimit: baseColdLimit }, now);
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
  async executeWithGate<T>(
    profileId: string,
    sendFn: () => Promise<T>,
    recipient?: string,
  ): Promise<T> {
    const prev = this.profileChains.get(profileId) ?? Promise.resolve();
    // Run after the previous send for this profile, whether it resolved or rejected.
    const runResult = prev.then(
      () => this.gatedRun(profileId, sendFn, recipient),
      () => this.gatedRun(profileId, sendFn, recipient),
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

  private async gatedRun<T>(
    profileId: string,
    sendFn: () => Promise<T>,
    recipient?: string,
  ): Promise<T> {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        messageDelayMs: true,
        messageDelayJitterMs: true,
        dailyMessageLimit: true,
        dailyMessageCount: true,
        dailyResetAt: true,
        warmupEnabled: true,
        warmupStartPerDay: true,
        warmupRampDays: true,
        warmupStartedAt: true,
        serviceWindowHours: true,
        coldDailyLimit: true,
        coldMessageCount: true,
      },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    // 1. Inter-message delay (block-and-wait), with optional additive jitter.
    // The base messageDelayMs is always the floor; jitter only ever slows sends.
    const baseDelay = profile.messageDelayMs ?? 1500;
    const jitterMax = Math.max(0, profile.messageDelayJitterMs ?? 0);
    const delayMs = baseDelay + (jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0);
    const last = this.lastSentAt.get(profileId) ?? 0;
    const wait = Math.max(0, delayMs - (Date.now() - last));
    if (wait > 0) await sleep(wait);
    // Record the attempt time now so a burst of failures/429s cannot collapse the
    // inter-message spacing.
    this.lastSentAt.set(profileId, Date.now());

    // 2. Lazy daily reset (WIB boundary) for both the total and cold counters.
    const now = new Date();
    let count = profile.dailyMessageCount ?? 0;
    let coldCount = profile.coldMessageCount ?? 0;
    let resetAt = profile.dailyResetAt ?? nextMidnightWIB(now);
    if (!profile.dailyResetAt || profile.dailyResetAt <= now) {
      count = 0;
      coldCount = 0;
      resetAt = nextMidnightWIB(now);
      await prisma.profile.update({
        where: { id: profileId },
        data: { dailyMessageCount: 0, coldMessageCount: 0, dailyResetAt: resetAt },
      });
    }

    // 3. Lane-aware cap. Replies (in service window) only hit the high overall
    // backstop; cold sends hit the dedicated cold cap (warm-up ramps toward it).
    const isCold = await classifyColdSend(profileId, recipient, profile.serviceWindowHours ?? 24, now);
    const cap = effectiveCapForLane(profile, isCold, now);
    const laneCount = isCold ? coldCount : count;
    if (cap != null && laneCount >= cap) {
      throw new HttpException(
        {
          error: isCold ? 'COLD_DAILY_LIMIT_REACHED' : 'DAILY_LIMIT_REACHED',
          lane: isCold ? 'cold' : 'service',
          limit: cap,
          count: laneCount,
          resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 4. Send, then increment counters only on a real successful send. Cold sends
    // advance both the total and the cold counter; replies advance only the total.
    const result = await sendFn();
    await prisma.profile.update({
      where: { id: profileId },
      data: {
        dailyMessageCount: { increment: 1 },
        ...(isCold ? { coldMessageCount: { increment: 1 } } : {}),
      },
    });
    return result;
  }
}

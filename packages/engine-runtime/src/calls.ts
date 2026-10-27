// MultiWA Gateway - Incoming WhatsApp calls (shared engine runtime)
// packages/engine-runtime/src/calls.ts
//
// Turns what the engines report about calls (IncomingCall states, call-log
// messages) into rows of the `calls` table and publishes every change to the app
// bus (webhooks), realtime (Socket.IO) and, for missed calls, notifications. Used by
// the api and worker engine-managers (whichever hosts the engine) and by the calls
// REST module, so the rules live once (call-state.ts). Replaces auto-reject-call.ts
// (removed once both engine-managers call handleEngineCall): the auto-reject is part
// of the ringing step, is recorded on the row, and its reply goes through the
// send-gated path at most once per caller per 24 h.

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import type { CallLogEntry, IncomingCall } from '@multiwa/engines';
import { followUpAfter, nextOutcome, outcomeForState, type CallFollowUp, type CallOutcome, type CallRejectedBy } from './call-state';
import { resolveChatJid, type IdentityResolver } from './jid';

export interface AutoRejectCallSettings {
  autoRejectCalls?: boolean;
  /** Optional reply sent to the caller after rejecting. Blank = reject silently. */
  autoRejectCallMessage?: string;
}

/** The `calls` columns this module reads (kept local: the runtime does not depend on Prisma's generated types). */
export interface CallRecord {
  id: string;
  profileId: string;
  waCallId: string;
  fromJid: string;
  isVideo: boolean;
  isGroup: boolean;
  direction: string;
  outcome: string;
  rejectedBy: string | null;
  startedAt: Date;
  endedAt: Date | null;
  followUp: string;
  assignedUserId: string | null;
  autoReplySentAt: Date | null;
  conversationId: string | null;
  metadata?: unknown;
}

export interface CallDeps {
  profileId: string;
  /** App-bus emit (drives webhooks), e.g. EventEmitter2.emit. */
  emit: (event: string, payload: Record<string, unknown>) => void;
  /** Realtime push of the change (RealtimeEmitter.emitCallUpdate). */
  emitRealtime: (payload: Record<string, unknown>) => void;
  /** Operator notification, pre-scoped to the profile and the CALL notification type. */
  notify: (title: string, body: string, meta: Record<string, unknown>) => Promise<unknown>;
  logger?: { log?: (m: string) => void; warn?: (m: string) => void };
  now?: () => Date;
}

export interface CallEngineDeps extends CallDeps {
  settings: AutoRejectCallSettings | null | undefined;
  rejectCall: (waCallId: string) => Promise<void>;
  /** Send-gated text send (MessagesService.sendText on api, WorkerMessagesService.sendText on worker). */
  sendText: (to: string, text: string) => Promise<unknown>;
  resolveIdentity?: IdentityResolver | null;
}

export const AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
// A call answered on the phone gets its call log when the conversation ends, possibly long after it rang.
export const CALL_LOG_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const CALL_LOG_CLOCK_SLACK_MS = 30 * 1000;
const CALL_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

/** How long a call may ring before it is closed as `unknown` (env CALL_RING_TIMEOUT_MS). */
export function ringTimeoutMs(): number {
  const n = Number(process.env.CALL_RING_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

/**
 * Webhook / realtime payload. Deliberately neither an `id` nor a `messageId` key: the
 * webhook dispatchers name a delivery job `<webhook>-<event>-<payload.id ?? payload.messageId>`
 * and BullMQ drops a job whose id exists, so one call emitting several events of one kind
 * would lose all but the first.
 */
export function toCallPayload(row: CallRecord): Record<string, unknown> {
  return {
    profileId: row.profileId,
    callId: row.id,
    waCallId: row.waCallId,
    from: row.fromJid,
    isVideo: row.isVideo,
    isGroup: row.isGroup,
    direction: row.direction,
    outcome: row.outcome,
    rejectedBy: row.rejectedBy,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    followUp: row.followUp,
    assignedUserId: row.assignedUserId,
  };
}

/** Publish a stored change to the app bus and realtime. Never throws. */
export function publishCall(deps: CallDeps, event: string, row: CallRecord): void {
  const payload = toCallPayload(row);
  try {
    deps.emit(event, payload);
  } catch (e) {
    deps.logger?.warn?.(`call event '${event}' failed: ${(e as Error).message}`);
  }
  try {
    deps.emitRealtime(payload);
  } catch (e) {
    deps.logger?.warn?.(`call realtime push failed: ${(e as Error).message}`);
  }
}

const clock = (deps: CallDeps): Date => deps.now?.() ?? new Date();
const metadataOf = (row: CallRecord): Record<string, unknown> => (row.metadata as Record<string, unknown> | null | undefined) ?? {};

async function findCall(profileId: string, waCallId: string): Promise<CallRecord | null> {
  return (await prisma.call.findUnique({ where: { profileId_waCallId: { profileId, waCallId } } })) as CallRecord | null;
}

/**
 * Handle one engine call signal. `ringing` creates the row (a repeated offer is a
 * no-op), arms the ring timeout and applies the profile's auto-reject; any other
 * state moves the stored outcome forward (nextOutcome).
 */
export async function handleEngineCall(call: IncomingCall, deps: CallEngineDeps): Promise<CallRecord | null> {
  if (!call?.id) return null;
  const state = call.state ?? 'ringing';
  if (state !== 'ringing') {
    const stored = await findCall(deps.profileId, call.id);
    if (!stored) return null; // started before this process did
    const target = outcomeForState(state);
    return target ? applyCallOutcome(stored, target, deps, { rejectedBy: 'device' }) : stored;
  }

  const existing = await findCall(deps.profileId, call.id);
  if (existing) return existing;

  // A ringing call is time-critical and the identity lookup below is a page round trip with no
  // timeout: start the reject first and settle it on the row once that exists.
  const rejection = deps.settings?.autoRejectCalls ? tryRejectCall(call.id, deps) : null;

  const { jid, lidJid } = await resolveChatJid(call.from ?? '', deps.resolveIdentity, (e) =>
    deps.logger?.warn?.(`LID resolve failed for ${call.from}: ${e.message}`),
  );
  if (!jid) {
    deps.logger?.warn?.(`call ${call.id} has no caller: not recorded`);
    return null;
  }
  const conversation = await prisma.conversation.findFirst({ where: { profileId: deps.profileId, jid }, select: { id: true } });
  let row: CallRecord;
  try {
    row = (await prisma.call.create({
      data: {
        profileId: deps.profileId,
        waCallId: call.id,
        fromJid: jid,
        isVideo: call.isVideo,
        isGroup: call.isGroup,
        startedAt: clock(deps),
        conversationId: conversation?.id ?? null,
        metadata: lidJid ? { lidJid } : {},
      },
    })) as CallRecord;
  } catch (e: any) {
    if (e?.code === 'P2002') return findCall(deps.profileId, call.id); // a concurrent duplicate offer won the insert
    throw e;
  }
  publishCall(deps, AppEvents.CALL.RECEIVED, row);
  armRingTimeout(row, deps);
  return rejection ? settleAutoReject(row, await rejection, deps) : row;
}

/** Reject on the engine. A failure (the caller hung up first, the page is gone) is logged, never thrown. */
async function tryRejectCall(waCallId: string, deps: CallEngineDeps): Promise<boolean> {
  try {
    await deps.rejectCall(waCallId);
    return true;
  } catch (e) {
    deps.logger?.warn?.(`auto-reject failed for call ${waCallId}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Record the result of the auto-reject. The call becomes `rejected` (by `auto`) only when the
 * reject worked; the reply follows the attempt either way, since a caller who hung up before we
 * could reject still deserves it.
 */
async function settleAutoReject(row: CallRecord, rejected: boolean, deps: CallEngineDeps): Promise<CallRecord> {
  let current = row;
  if (rejected) {
    deps.logger?.log?.(`Auto-rejected call ${row.waCallId} from ${row.fromJid}`);
    current = await applyCallOutcome(row, 'rejected', deps, { rejectedBy: 'auto' });
  }
  await maybeAutoReply(current, deps);
  return current;
}

/** One reply per caller per AUTO_REPLY_WINDOW_MS, claimed before sending so a quick redial cannot reply twice. */
async function maybeAutoReply(row: CallRecord, deps: CallEngineDeps): Promise<void> {
  const text = deps.settings?.autoRejectCallMessage?.trim();
  if (!text || row.isGroup) return;
  const now = clock(deps);
  const recent = await prisma.call.findFirst({
    where: { profileId: row.profileId, fromJid: row.fromJid, autoReplySentAt: { gte: new Date(now.getTime() - AUTO_REPLY_WINDOW_MS) } },
    select: { id: true },
  });
  if (recent) return;
  await prisma.call.update({ where: { id: row.id }, data: { autoReplySentAt: now } });
  try {
    await deps.sendText(row.fromJid, text);
  } catch (e) {
    await prisma.call.update({ where: { id: row.id }, data: { autoReplySentAt: null } }).catch(() => undefined);
    deps.logger?.warn?.(`auto-reject reply failed: ${(e as Error).message}`);
  }
}

/**
 * Move a call's outcome forward and publish the change. Compare-and-set on the
 * stored outcome, so two signals racing (end event and call log) cannot move it
 * backwards, whichever lands first; on a lost race the row is re-read and the rule
 * applied again.
 */
export async function applyCallOutcome(
  row: CallRecord,
  target: CallOutcome,
  deps: CallDeps,
  opts: { rejectedBy?: CallRejectedBy; notifyUnknown?: boolean } = {},
): Promise<CallRecord> {
  const next = nextOutcome(row.outcome as CallOutcome, target);
  if (!next) return row;
  const data: Record<string, unknown> = {
    outcome: next,
    endedAt: row.endedAt ?? clock(deps),
    followUp: followUpAfter(next, row.followUp as CallFollowUp),
  };
  if (next === 'rejected') data.rejectedBy = opts.rejectedBy ?? 'device';
  const res = await prisma.call.updateMany({ where: { id: row.id, outcome: row.outcome }, data });
  if (res.count === 0) {
    const fresh = (await prisma.call.findUnique({ where: { id: row.id } })) as CallRecord | null;
    return fresh ? applyCallOutcome(fresh, target, deps, opts) : row;
  }
  clearRingTimeout(row);
  const updated = { ...row, ...data } as CallRecord;
  const event = row.outcome !== 'ringing' ? AppEvents.CALL.UPDATED : next === 'rejected' ? AppEvents.CALL.REJECTED : AppEvents.CALL.ENDED;
  publishCall(deps, event, updated);
  if (next === 'missed' || (next === 'unknown' && opts.notifyUnknown)) await notifyMissed(updated, deps);
  return updated;
}

/**
 * A call-log message carries the final outcome of a call, and for whatsapp-web.js the id of
 * that call (`entry.callId`).
 * - With a call id, the call is looked up by it. A call that is not final yet (ringing /
 *   unknown) is refined; a final one (e.g. our own auto-reject, whose log follows) only gets
 *   the log remembered, with no new outcome, event or notification; an unknown one is
 *   recorded under that call id (the ringing was never seen: detection failed, the process
 *   restarted).
 * - Without one (other engines, older builds) the latest incoming call from the same caller
 *   that started within CALL_LOG_MATCH_WINDOW_MS before the log is taken, whatever its
 *   outcome, unless that call already has a log of its own: then this log is another call,
 *   recorded as `log:<messageId>`.
 * A row created here never triggers the auto-reply (owner decision D8 cannot be met from a
 * log: whatsapp-web.js gets no signal at all for a call that rang while the device was
 * offline, and Baileys' offline offers arrive as `ringing`, the normal path).
 */
export async function handleCallLog(entry: CallLogEntry, deps: CallEngineDeps): Promise<CallRecord | null> {
  const now = clock(deps);
  if (now.getTime() - entry.timestamp.getTime() > CALL_LOG_MAX_AGE_MS) return null; // a replayed old log
  // The adapter's dedupe is per process and bounded: a replayed log must not create a phantom row.
  const seen = await prisma.call.findFirst({
    where: { profileId: deps.profileId, metadata: { path: ['callLogMessageId'], equals: entry.messageId } },
    select: { id: true },
  });
  if (seen) return null;

  if (entry.callId) {
    const stored = await findCall(deps.profileId, entry.callId);
    if (stored) return attachCallLog(stored, entry, deps);
  }

  const { jid, lidJid } = await resolveChatJid(entry.from ?? '', deps.resolveIdentity, (e) =>
    deps.logger?.warn?.(`LID resolve failed for ${entry.from}: ${e.message}`),
  );
  if (!jid) {
    deps.logger?.warn?.(`call log ${entry.messageId} has no caller: not recorded`);
    return null;
  }

  let waCallId = entry.callId;
  if (!waCallId) {
    const candidates = lidJid && lidJid !== jid ? [jid, lidJid] : [jid];
    const match = (await prisma.call.findFirst({
      where: {
        profileId: deps.profileId,
        direction: 'incoming',
        fromJid: { in: candidates },
        startedAt: {
          gte: new Date(entry.timestamp.getTime() - CALL_LOG_MATCH_WINDOW_MS),
          lte: new Date(entry.timestamp.getTime() + CALL_LOG_CLOCK_SLACK_MS),
        },
      },
      orderBy: { startedAt: 'desc' },
    })) as CallRecord | null;
    if (match && !metadataOf(match).callLogMessageId) return attachCallLog(match, entry, deps);

    waCallId = `log:${entry.messageId}`;
    if (await findCall(deps.profileId, waCallId)) return null;
  }

  const conversation = await prisma.conversation.findFirst({ where: { profileId: deps.profileId, jid }, select: { id: true } });
  let row: CallRecord;
  try {
    row = (await prisma.call.create({
      data: {
        profileId: deps.profileId,
        waCallId,
        fromJid: jid,
        isVideo: entry.isVideo,
        isGroup: entry.from.endsWith('@g.us'),
        startedAt: entry.timestamp,
        endedAt: now,
        outcome: entry.outcome,
        rejectedBy: entry.outcome === 'rejected' ? 'device' : null,
        followUp: followUpAfter(entry.outcome, 'open'),
        conversationId: conversation?.id ?? null,
        metadata: lidJid
          ? { source: 'call_log', callLogMessageId: entry.messageId, lidJid }
          : { source: 'call_log', callLogMessageId: entry.messageId },
      },
    })) as CallRecord;
  } catch (e: any) {
    if (e?.code !== 'P2002') throw e;
    // The ringing (or another copy of this log) created the call between our lookup and our insert: settle that one.
    const raced = await findCall(deps.profileId, waCallId);
    return raced ? attachCallLog(raced, entry, deps) : null;
  }
  publishCall(deps, entry.outcome === 'rejected' ? AppEvents.CALL.REJECTED : AppEvents.CALL.ENDED, row);
  if (row.outcome === 'missed') await notifyMissed(row, deps);
  return row;
}

/**
 * Settle a stored call with its call log and remember which log did, so a replay of it changes
 * nothing. A call that is already final keeps its outcome (nextOutcome): only the log is stored.
 */
async function attachCallLog(row: CallRecord, entry: CallLogEntry, deps: CallDeps): Promise<CallRecord> {
  // A log saying `rejected` for a call we did not reject was declined on the phone.
  const settled = await applyCallOutcome(row, entry.outcome, deps, { rejectedBy: 'device' });
  const metadata = { ...metadataOf(settled), callLogMessageId: entry.messageId };
  await prisma.call.update({ where: { id: row.id }, data: { metadata } });
  return { ...settled, metadata };
}

/** Boot sweep: a restart loses the ring timers, so calls left ringing are closed as `unknown`. */
export async function closeStaleRingingCalls(at: Date = new Date()): Promise<number> {
  const res = await prisma.call.updateMany({
    where: { outcome: 'ringing', startedAt: { lt: new Date(at.getTime() - ringTimeoutMs()) } },
    data: { outcome: 'unknown', endedAt: at },
  });
  return res.count;
}

/** An agent pressed Reject on a ringing call. Errors start with a code the API maps to HTTP. */
export async function rejectCallByAgent(
  callId: string,
  deps: CallDeps & { rejectCall: (waCallId: string) => Promise<void> },
): Promise<CallRecord> {
  const row = (await prisma.call.findUnique({ where: { id: callId } })) as CallRecord | null;
  if (!row || row.profileId !== deps.profileId) throw new Error(`CALL_NOT_FOUND: ${callId}`);
  if (row.outcome !== 'ringing') throw new Error(`CALL_NOT_RINGING: ${callId}`);
  await deps.rejectCall(row.waCallId);
  return applyCallOutcome(row, 'rejected', deps, { rejectedBy: 'agent' });
}

// ── ring timeout ───────────────────────────────────────────────────────────────────────
const ringTimers = new Map<string, NodeJS.Timeout>();
const timerKey = (row: { profileId: string; waCallId: string }) => `${row.profileId}:${row.waCallId}`;

function armRingTimeout(row: CallRecord, deps: CallDeps): void {
  const key = timerKey(row);
  const timer = setTimeout(async () => {
    ringTimers.delete(key);
    try {
      const fresh = await findCall(row.profileId, row.waCallId);
      if (fresh?.outcome === 'ringing') await applyCallOutcome(fresh, 'unknown', deps, { notifyUnknown: true });
    } catch (e) {
      deps.logger?.warn?.(`ring timeout for call ${row.waCallId} failed: ${(e as Error).message}`);
    }
  }, ringTimeoutMs());
  timer.unref?.();
  ringTimers.set(key, timer);
}

function clearRingTimeout(row: { profileId: string; waCallId: string }): void {
  const key = timerKey(row);
  const timer = ringTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(key);
  }
}

// ── notifications ──────────────────────────────────────────────────────────────────────
// ponytail: per-process throttle; good enough for one engine host, move to Redis if hosts multiply.
const lastNotified = new Map<string, number>();

async function notifyMissed(row: CallRecord, deps: CallDeps): Promise<void> {
  const key = `${row.profileId}:${row.fromJid}`;
  const now = clock(deps).getTime();
  const last = lastNotified.get(key);
  if (last !== undefined && now - last < NOTIFY_THROTTLE_MS) return;
  if (lastNotified.size > 5000) lastNotified.clear();
  lastNotified.set(key, now);
  const kind = row.isVideo ? 'video' : 'voice';
  const title = row.outcome === 'missed' ? `📞 Missed ${kind} call` : `📞 Unanswered ${kind} call?`;
  try {
    await deps.notify(title, `From ${row.fromJid.split('@')[0]}`, { callId: row.id, profileId: row.profileId, from: row.fromJid });
  } catch (e) {
    deps.logger?.warn?.(`call notification failed: ${(e as Error).message}`);
  }
}

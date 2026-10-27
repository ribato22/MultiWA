// MultiWA Gateway - Incoming WhatsApp calls (shared engine runtime)
// packages/engine-runtime/src/calls.ts
//
// Turns what the engines report about calls (IncomingCall states, call-log
// messages) into rows of the `calls` table and publishes every change to the app
// bus (webhooks), realtime (Socket.IO) and, for missed calls, notifications. Used by
// the api and worker engine-managers (whichever hosts the engine) and by the calls
// REST module, so the rules live once (call-state.ts). The auto-reject is part of the
// ringing step, is recorded on the row, and its reply goes through the send-gated
// path at most once per caller per 24 h.

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
  /**
   * The profile's auto-reject settings, or the read of them still in progress. The ringing step awaits them
   * itself, so the caller hands an offer over without awaiting anything first: handleEngineCall has to be
   * called in the order the engine reported its calls (see callsInFlight). A promise must not reject: resolve
   * it to null when the read fails, and the call is recorded without an auto-reject.
   */
  settings: AutoRejectCallSettings | null | undefined | Promise<AutoRejectCallSettings | null | undefined>;
  rejectCall: (waCallId: string) => Promise<void>;
  /**
   * Send-gated text send (MessagesService.sendText on the api, WorkerMessagesService.sendText on the worker). Both
   * RESOLVE when the message was not sent ({ success: false }, or { status: 'pending' } for a profile without an
   * engine), so each engine manager adapts the result: it must REJECT when the reply was not sent, because the
   * once-per-24h claim on the call is released only then.
   */
  sendText: (to: string, text: string) => Promise<unknown>;
  resolveIdentity?: IdentityResolver | null;
}

export const AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
// Only for a call log WITHOUT a call id, which is matched to the latest call of its caller instead: how long
// before the log that call may have started. Not sized for a call answered on the phone: a live probe showed
// the engine reports it (AcceptedElsewhere) the moment the phone answers, not when the conversation ends.
export const CALL_LOG_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const CALL_LOG_CLOCK_SLACK_MS = 30 * 1000;
const CALL_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

/** How long a call may ring before it is closed as `unknown` (env CALL_RING_TIMEOUT_MS). */
export function ringTimeoutMs(): number {
  const n = Number(process.env.CALL_RING_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

/** How long an ended call waits for its call log before it is reported as unanswered (env CALL_LOG_GRACE_MS). */
function callLogGraceMs(): number {
  const n = Number(process.env.CALL_LOG_GRACE_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
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

async function findCallById(id: string): Promise<CallRecord | null> {
  return (await prisma.call.findUnique({ where: { id } })) as CallRecord | null;
}

/** One call of one profile: the key of its timer and of the step settling it. */
const callKey = (row: { profileId: string; waCallId: string }) => `${row.profileId}:${row.waCallId}`;

// The step that settles a call (its ringing step: find the caller, record the call, arm its ring timeout,
// auto-reject and reply; or an agent's reject) runs for as long as the identity lookup and the engine take,
// while the engine keeps reporting the same call: its end, its call log (10-15 ms after the end; tens of ms
// after our own reject), our own reject echoed back, a repeated offer. Each of those waits here until the
// call is RECORDED (its row exists and says who rejected it) instead of reading a row that does not exist
// yet, or relabelling the one we are rejecting. They do not wait for the reply that follows: it goes through
// the send gate (a 1.5 s floor, minutes behind a campaign) and tells them nothing. Only a repeated offer
// joins the whole step, so it can neither reject nor record the call a second time.
// ponytail: per-process registry; the engine host owns all signals of a profile.
interface CallStep {
  profileId: string;
  /** Settles once the call is recorded, or when the step ends, whichever comes first. Never rejects. */
  recorded: Promise<void>;
  /** The whole step, reply included. */
  done: Promise<CallRecord | null>;
}
const callsInFlight = new Map<string, CallStep>();

/** Run `step` as the one settling this call. It calls `recorded()` as soon as the row says what happened. */
function trackStep<T extends CallRecord | null>(
  call: { profileId: string; waCallId: string },
  step: (recorded: () => void) => Promise<T>,
): Promise<T> {
  const key = callKey(call);
  let markRecorded!: () => void;
  const recorded = new Promise<void>((resolve) => { markRecorded = resolve; });
  const done: Promise<T> = step(markRecorded).finally(() => {
    markRecorded(); // a step that fails or ends without a call to record releases its waiters too
    if (callsInFlight.get(key)?.done === done) callsInFlight.delete(key);
  });
  callsInFlight.set(key, { profileId: call.profileId, recorded, done });
  return done;
}

/** Wait until this call is recorded, if a step is settling it. The step's failure is its own caller's, not ours. */
async function untilRecorded(profileId: string, waCallId: string): Promise<void> {
  await callsInFlight.get(callKey({ profileId, waCallId }))?.recorded;
}

/** Calls being settled by a step; the specs check that it always empties. */
export const __callsInFlightForTests = (): number => callsInFlight.size;

/**
 * Handle one engine call signal. `ringing` creates the row, arms the ring timeout and applies the
 * profile's auto-reject (a repeated offer joins the ringing step that is already running); any
 * other state moves the stored outcome forward (nextOutcome), once the call is recorded.
 * Call it from the engine callback itself, in the order the engine reports, with nothing awaited
 * before it (pass `deps.settings` as a promise): a signal finds the ringing step of its call only
 * if the offer was handed over before it.
 */
export async function handleEngineCall(call: IncomingCall, deps: CallEngineDeps): Promise<CallRecord | null> {
  if (!call?.id) return null;
  const state = call.state ?? 'ringing';
  if (state !== 'ringing') {
    await untilRecorded(deps.profileId, call.id);
    const stored = await findCall(deps.profileId, call.id);
    if (!stored) return null; // started before this process did
    const target = outcomeForState(state);
    return target ? applyCallOutcome(stored, target, deps, { rejectedBy: 'device' }) : stored;
  }

  const ring = { profileId: deps.profileId, waCallId: call.id };
  const running = callsInFlight.get(callKey(ring));
  if (running) return running.done; // a repeated offer must not reject the call a second time
  return trackStep(ring, (recorded) => handleRinging(call, deps, recorded));
}

/** The ringing step: reject, record and announce the call, arm its ring timeout, settle the auto-reject. */
async function handleRinging(call: IncomingCall, deps: CallEngineDeps, recorded: () => void): Promise<CallRecord | null> {
  // The settings may still be being read: that is the one wait before the reject, and it is taken here, inside
  // the registered step, so the signals that follow the offer wait for the step instead of overtaking it.
  const settings = await deps.settings;
  // A ringing call is time-critical, and neither the calls table (it may hang or be missing) nor the
  // identity lookup (a page round trip with no timeout) may delay the reject: start it first and settle
  // it on the row once that exists.
  const rejection = settings?.autoRejectCalls ? tryRejectCall(call.id, deps) : null;

  // An offer replayed for a call we already know (after a restart) is rejected again: harmless, the engine
  // says "not ringing any more" if it let the call go. Nothing is recorded then, so nothing waits for it.
  const existing = await findCall(deps.profileId, call.id);
  if (existing) return existing;

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
  return rejection ? settleAutoReject(row, await rejection, settings?.autoRejectCallMessage, deps, recorded) : row;
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
 * could reject still deserves it. The call is recorded once the outcome is, before the reply.
 */
async function settleAutoReject(
  row: CallRecord,
  rejected: boolean,
  message: string | undefined,
  deps: CallEngineDeps,
  recorded: () => void,
): Promise<CallRecord> {
  let current = row;
  if (rejected) {
    deps.logger?.log?.(`Auto-rejected call ${row.waCallId} from ${row.fromJid}`);
    current = await applyCallOutcome(row, 'rejected', deps, { rejectedBy: 'auto' });
  }
  recorded();
  await maybeAutoReply(current, message, deps);
  return current;
}

/**
 * One reply per caller per AUTO_REPLY_WINDOW_MS, claimed before sending so a quick redial cannot reply twice.
 * Never throws: the call is recorded by now, and a database blip must not fail the ringing step. A reply
 * that cannot be claimed is not sent (better none than two).
 */
async function maybeAutoReply(row: CallRecord, message: string | undefined, deps: CallEngineDeps): Promise<void> {
  const text = message?.trim();
  if (!text || row.isGroup) return;
  const now = clock(deps);
  try {
    const recent = await prisma.call.findFirst({
      where: { profileId: row.profileId, fromJid: row.fromJid, autoReplySentAt: { gte: new Date(now.getTime() - AUTO_REPLY_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) return;
    await prisma.call.update({ where: { id: row.id }, data: { autoReplySentAt: now } });
  } catch (e) {
    deps.logger?.warn?.(`auto-reject reply for call ${row.waCallId} skipped: ${(e as Error).message}`);
    return;
  }
  try {
    await deps.sendText(row.fromJid, text);
  } catch (e) {
    deps.logger?.warn?.(`auto-reject reply failed: ${(e as Error).message}`);
    await prisma.call.update({ where: { id: row.id }, data: { autoReplySentAt: null } }).catch((err) =>
      deps.logger?.warn?.(`auto-reject reply of call ${row.waCallId} could not be released: ${(err as Error).message}`),
    );
  }
}

/**
 * Move a call's outcome forward and publish the change. Compare-and-set on the
 * stored outcome, so two signals racing (end event and call log) cannot move it
 * backwards, whichever lands first; on a lost race the row is re-read and the rule
 * applied again.
 * A call that becomes `unknown` without `notifyUnknown` (it stopped ringing, as `ended` says) is
 * notified as unanswered only if no call log has settled it CALL_LOG_GRACE_MS later.
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
    const fresh = await findCallById(row.id);
    return fresh ? applyCallOutcome(fresh, target, deps, opts) : row;
  }
  clearRingTimeout(row);
  const updated = { ...row, ...data } as CallRecord;
  const event = row.outcome !== 'ringing' ? AppEvents.CALL.UPDATED : next === 'rejected' ? AppEvents.CALL.REJECTED : AppEvents.CALL.ENDED;
  publishCall(deps, event, updated);
  if (next === 'missed' || (next === 'unknown' && opts.notifyUnknown)) await notifyMissed(updated, deps);
  else if (next === 'unknown') armLogGrace(updated, deps); // the call log usually settles it (and notifies) within moments
  return updated;
}

/**
 * A call-log message carries the final outcome of a call, and for whatsapp-web.js the id of
 * that call (`entry.callId`).
 * - With a call id, the call is looked up by it, once the call is recorded if its ringing step is
 *   still running (the log can beat it by far: it follows our own reject within tens of ms, the
 *   identity lookup takes 100+). A call that is not final yet (ringing / unknown) is refined; a
 *   final one (e.g. our own auto-reject, whose log follows) only gets the log remembered, with
 *   no new outcome, event or notification; an unknown one is recorded under that call id (the
 *   ringing was never seen: detection failed, the process restarted).
 * - Without one (other engines, older builds) the latest incoming call from the same caller
 *   that started within CALL_LOG_MATCH_WINDOW_MS before the log is taken, whatever its
 *   outcome, unless that call already has a log of its own: then this log is another call,
 *   recorded as `log:<messageId>`. Nothing says which call the log is about, so it waits until
 *   every call of the profile that is being settled is recorded, to find the row it belongs to.
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
    await untilRecorded(deps.profileId, entry.callId);
    const stored = await findCall(deps.profileId, entry.callId);
    if (stored) return attachCallLog(stored, entry, deps);
  } else {
    await Promise.all([...callsInFlight.values()].filter((step) => step.profileId === deps.profileId).map((step) => step.recorded));
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

/** What the engine adapters throw from `rejectCall` for a call they no longer hold (it ended, was answered or rejected). */
const ENGINE_CALL_GONE = /not ringing any more/i;

/**
 * How long an agent's reject may wait for the engine (the engine managers apply it with withTimeout). The call is
 * held in callsInFlight meanwhile, and everything the engine reports about it waits: a stuck page (puppeteer's
 * protocolTimeout is 240 s) must not hold it for minutes. Below the 30 s the REST layer waits for the reject
 * (CallsService), so the call is let go before the agent is answered 504, not long after.
 */
export const AGENT_REJECT_TIMEOUT_MS = 25_000;

/**
 * An agent pressed Reject on a ringing call. Errors start with a code the API maps to HTTP.
 * Registered as the step settling the call while the engine rejects it, so that what the engine reports
 * meanwhile (the echo of this reject, its call log) waits instead of recording the phone as the rejecter.
 */
export async function rejectCallByAgent(
  callId: string,
  deps: CallDeps & { rejectCall: (waCallId: string) => Promise<void> },
): Promise<CallRecord> {
  let row = await findCallById(callId);
  if (row?.profileId === deps.profileId && callsInFlight.has(callKey(row))) {
    // The ringing step is still settling this call (it may be rejecting it itself): let it finish, then judge the call as it stands.
    await untilRecorded(row.profileId, row.waCallId);
    row = await findCallById(callId);
  }
  if (!row || row.profileId !== deps.profileId) throw new Error(`CALL_NOT_FOUND: ${callId}`);
  if (row.outcome !== 'ringing') throw new Error(`CALL_NOT_RINGING: ${callId}`);
  const ringing = row;
  return trackStep(ringing, async () => {
    try {
      await deps.rejectCall(ringing.waCallId);
    } catch (e) {
      // The call is gone whatever the row says yet: the signals that ended it are queued behind this very step.
      if (ENGINE_CALL_GONE.test((e as Error).message)) throw new Error(`CALL_NOT_RINGING: ${callId}`);
      throw e;
    }
    return applyCallOutcome(ringing, 'rejected', deps, { rejectedBy: 'agent' });
  });
}

// ── ring timeout and call-log grace ────────────────────────────────────────────────────
// One timer per call, in one map: the ring timeout while it rings; once `ended` has moved it to
// `unknown`, the grace period for its call log instead. Any later change of the call clears it
// (applyCallOutcome), and either fires on a fresh read of the row.
const ringTimers = new Map<string, NodeJS.Timeout>();

function armTimer(what: string, row: CallRecord, ms: number, deps: CallDeps, onFire: (fresh: CallRecord | null) => Promise<unknown>): void {
  clearRingTimeout(row);
  const key = callKey(row);
  const timer = setTimeout(async () => {
    ringTimers.delete(key);
    try {
      await onFire(await findCall(row.profileId, row.waCallId));
    } catch (e) {
      deps.logger?.warn?.(`${what} for call ${row.waCallId} failed: ${(e as Error).message}`);
    }
  }, ms);
  timer.unref?.();
  ringTimers.set(key, timer);
}

function armRingTimeout(row: CallRecord, deps: CallDeps): void {
  armTimer('ring timeout', row, ringTimeoutMs(), deps, async (fresh) => {
    if (fresh?.outcome === 'ringing') await applyCallOutcome(fresh, 'unknown', deps, { notifyUnknown: true });
  });
}

/** An ended call no call log has settled by the end of the grace period is reported as unanswered. */
function armLogGrace(row: CallRecord, deps: CallDeps): void {
  armTimer('call log grace', row, callLogGraceMs(), deps, async (fresh) => {
    if (fresh?.outcome === 'unknown') await notifyMissed(fresh, deps);
  });
}

function clearRingTimeout(row: { profileId: string; waCallId: string }): void {
  const key = callKey(row);
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
  lastNotified.set(key, now); // claimed before sending, so a second signal while this one is on its way does not notify again
  const kind = row.isVideo ? 'video' : 'voice';
  const title = row.outcome === 'missed' ? `📞 Missed ${kind} call` : `📞 Unanswered ${kind} call?`;
  try {
    await deps.notify(title, `From ${row.fromJid.split('@')[0]}`, { callId: row.id, profileId: row.profileId, from: row.fromJid });
  } catch (e) {
    lastNotified.delete(key); // released: a failed notification must not hide the next one for ten minutes
    deps.logger?.warn?.(`call notification failed: ${(e as Error).message}`);
  }
}

// MultiWA Gateway - WhatsApp call event helpers
// packages/engines/src/call-events.ts
//
// After a call WhatsApp writes a call-log message into the chat ("Missed voice call").
// Its outcome is the authoritative end of the call: whatsapp-web.js' live call events
// only say that the call stopped ringing, not whether it was answered on the phone.
// Outcome values follow WAProto's Message.CallLogMessage.CallOutcome; WhatsApp Web may
// expose them as the enum number or as its name (in any case, PascalCase on current
// builds), so all are accepted.

import { resolveWaMessageId } from '@multiwa/core';
import type { CallLogEntry, CallLogOutcome, CallState } from './types';

const OUTCOME_BY_NUMBER: Record<number, CallLogOutcome | null> = {
  0: 'answered_elsewhere', // CONNECTED: we never answer, so another device did
  1: 'missed',             // MISSED
  2: null,                 // FAILED: no reliable outcome
  3: 'rejected',           // REJECTED
  4: 'answered_elsewhere', // ACCEPTED_ELSEWHERE
  5: null,                 // ONGOING: not final yet
  6: 'missed',             // SILENCED_BY_DND
  7: 'missed',             // SILENCED_UNKNOWN_CALLER
};

const OUTCOME_BY_NAME: Record<string, CallLogOutcome | null> = {
  connected: 'answered_elsewhere',
  missed: 'missed',
  failed: null,
  rejected: 'rejected',
  accepted_elsewhere: 'answered_elsewhere',
  ongoing: null,
  silenced_by_dnd: 'missed',
  silenced_unknown_caller: 'missed',
  completed: 'answered_elsewhere', // older synced logs say Completed for a call that was answered
};

// Verified on a live WhatsApp Web 2.3000.10518155xx (2026-10-27): `callOutcome` holds the
// outcome's name (Ongoing / Missed / Rejected / AcceptedElsewhere / Completed) and
// `isVideoCall` the flag. Extend when WhatsApp renames them. The first outcome field
// present wins; any true video field wins.
const OUTCOME_FIELDS = ['callOutcome', 'outcome'];
const VIDEO_FIELDS = ['isVideoCall', 'isVideo', 'callIsVideo'];

/** A JID as a string, whatever WhatsApp Web handed over (string, Wid with `_serialized` or `$1`, or `{ user, server }`). */
export function toJidString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v._serialized === 'string' && v._serialized) return v._serialized;
    if (typeof v.$1 === 'string' && v.$1) return v.$1;
    if (typeof v.user === 'string' && v.user && typeof v.server === 'string' && v.server) return `${v.user}@${v.server}`;
  }
  return '';
}

/** undefined = not an outcome we know; null = a known outcome that is not final (Ongoing, Failed). */
function lookupOutcome(raw: unknown): CallLogOutcome | null | undefined {
  if (typeof raw === 'number') return OUTCOME_BY_NUMBER[raw];
  if (typeof raw !== 'string') return undefined;
  // camelCase first (AcceptedElsewhere -> accepted_elsewhere). No nested quantifiers: no ReDoS.
  const key = raw.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_');
  if (/^\d+$/.test(key)) return OUTCOME_BY_NUMBER[Number(key)];
  // Own keys only: a plain-object lookup returns Object for 'constructor'.
  return Object.prototype.hasOwnProperty.call(OUTCOME_BY_NAME, key) ? OUTCOME_BY_NAME[key] : undefined;
}

/** The raw outcome of a call-log message: the first outcome field that is present. */
function rawOutcomeOf(message: any): unknown {
  const data = message?._data ?? {};
  return OUTCOME_FIELDS.map((f) => data[f]).find((v) => v !== undefined && v !== null);
}

/** Raw call outcome (enum number, its name in any case, or a numeric string) -> ours; null = not final / unknown. */
export function parseCallLogOutcome(raw: unknown): CallLogOutcome | null {
  return lookupOutcome(raw) ?? null;
}

/**
 * An incoming call-log message whose outcome is one we know but that is not final yet
 * (Ongoing, Failed). Every live call starts as Ongoing, so this is normal, not a shape to
 * warn about; `readCallLog` gives no entry for it until the outcome changes.
 */
export function isPendingCallLog(message: any): boolean {
  if (!message || message.type !== 'call_log' || message.fromMe) return false;
  return lookupOutcome(rawOutcomeOf(message)) === null;
}

// A call log's message id is `<fromMe>_<peer>_<CALLID>`, CALLID being the engine's own call id
// (32 upper-case hex characters, verified on live calls). Anything else after the last `_`
// (a participant JID, a short token) is not one.
const CALL_ID = /^[0-9A-Fa-f]{16,64}$/;

function callIdOf(messageId: string): string | undefined {
  const last = messageId.slice(messageId.lastIndexOf('_') + 1);
  return last !== messageId && CALL_ID.test(last) ? last : undefined;
}

/**
 * A whatsapp-web.js message of type `call_log`, normalized. Null unless it is an incoming
 * call with a final outcome, a caller JID, and an id or a plausible timestamp (an
 * implausible timestamp is replaced by now). `callId` is set when the message id carries it.
 */
export function readCallLog(message: any): CallLogEntry | null {
  if (!message || message.type !== 'call_log' || message.fromMe) return null; // incoming calls only
  const data = message._data ?? {};
  const outcome = parseCallLogOutcome(rawOutcomeOf(message));
  if (!outcome) return null;
  const from = toJidString(message.from);
  if (!from) return null;
  const ts = message.timestamp;
  // Seconds since the epoch; anything else (NaN, 0, milliseconds) is not trusted.
  const validTs = typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && ts < 1e11;
  const id = resolveWaMessageId(message);
  if (!id && !validTs) return null; // no stable dedupe key
  const seconds = validTs ? ts : Math.floor(Date.now() / 1000);
  const callId = id ? callIdOf(id) : undefined;
  return {
    messageId: id ?? `call_log:${from}:${seconds}`,
    ...(callId ? { callId } : {}),
    from,
    isVideo: VIDEO_FIELDS.some((f) => data[f] === true),
    outcome,
    timestamp: new Date(seconds * 1000),
  };
}

/**
 * Baileys call update -> CallState. Baileys reports a `terminate` stanza with reason
 * `timeout` (an offer that rang out unanswered) as `timeout`, and every other
 * `terminate` (after accept, reject or a hang-up) as `terminate`, which therefore maps
 * to `ended`, outcome unknown.
 * Any other status, including Baileys' catch-all `ringing` for stanzas it does not
 * classify, carries nothing new.
 */
export function mapBaileysCallStatus(status: string): CallState | null {
  switch (status) {
    case 'offer': return 'ringing';
    case 'accept': return 'accepted';
    case 'reject': return 'rejected';
    case 'timeout': return 'missed';
    case 'terminate': return 'ended';
    default: return null;
  }
}

/** How many recent ids an adapter remembers to tell a repeat from something new. */
export const MAX_REMEMBERED_IDS = 500;

/** Add to a bounded set, evicting the oldest entry first. */
export function remember(set: Set<string>, key: string, max: number): void {
  if (set.size >= max) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(key);
}

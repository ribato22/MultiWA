// MultiWA Gateway - WhatsApp call event helpers (pure)
// packages/engines/src/call-events.ts
//
// After a call WhatsApp writes a call-log message into the chat ("Missed voice call").
// Its outcome is the authoritative end of the call: whatsapp-web.js' live call events
// only say that the call stopped ringing, not whether it was answered on the phone.
// Outcome values follow WAProto's Message.CallLogMessage.CallOutcome; WhatsApp Web may
// expose them as the enum number or as its name, so both are accepted.

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
};

// Field names on the raw message model, most likely first (confirmed by the live
// probe, Milestone 0). Extend when WhatsApp renames them.
const OUTCOME_FIELDS = ['callOutcome', 'outcome'];
const VIDEO_FIELDS = ['isVideoCall', 'isVideo', 'callIsVideo'];

/** A JID as a string, whatever WhatsApp Web handed over (string, Wid with `_serialized` or `$1`, or `{ user, server }`). */
export function toJidString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v._serialized === 'string' && v._serialized) return v._serialized;
    if (typeof v.$1 === 'string' && v.$1) return v.$1;
    if (typeof v.user === 'string' && typeof v.server === 'string') return `${v.user}@${v.server}`;
  }
  return '';
}

/** Raw call outcome (enum number, its name in any case, or a numeric string) -> ours; null = not final / unknown. */
export function parseCallLogOutcome(raw: unknown): CallLogOutcome | null {
  if (typeof raw === 'number') return OUTCOME_BY_NUMBER[raw] ?? null;
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/^\d+$/.test(key)) return OUTCOME_BY_NUMBER[Number(key)] ?? null;
  return Object.prototype.hasOwnProperty.call(OUTCOME_BY_NAME, key) ? OUTCOME_BY_NAME[key] : null;
}

/** A whatsapp-web.js message of type `call_log`, normalized; null when it is not an incoming call with a final outcome. */
export function readCallLog(message: any): CallLogEntry | null {
  if (!message || message.type !== 'call_log' || message.fromMe) return null; // incoming calls only
  const data = message._data ?? {};
  const rawOutcome = OUTCOME_FIELDS.map((f) => data[f]).find((v) => v !== undefined && v !== null);
  const outcome = parseCallLogOutcome(rawOutcome);
  if (!outcome) return null;
  const from = toJidString(message.from);
  const seconds = typeof message.timestamp === 'number' ? message.timestamp : Math.floor(Date.now() / 1000);
  return {
    messageId: resolveWaMessageId(message) ?? `call_log:${from}:${seconds}`,
    from,
    isVideo: VIDEO_FIELDS.some((f) => data[f] === true),
    outcome,
    timestamp: new Date(seconds * 1000),
  };
}

/**
 * Baileys call update -> CallState. Baileys reports every step (offer, ringing,
 * accept, reject, timeout, terminate); `ringing` is its own outgoing-ring notice and
 * carries nothing new, and a `terminate` without a prior `accept` means the caller
 * hung up before anyone answered.
 */
export function mapBaileysCallStatus(status: string, wasAccepted: boolean): CallState | null {
  switch (status) {
    case 'offer': return 'ringing';
    case 'accept': return 'accepted';
    case 'reject': return 'rejected';
    case 'timeout': return 'missed';
    case 'terminate': return wasAccepted ? 'ended' : 'missed';
    default: return null;
  }
}

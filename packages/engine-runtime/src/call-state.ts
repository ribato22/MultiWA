// MultiWA Gateway - Call outcome and follow-up rules (pure)
// packages/engine-runtime/src/call-state.ts
//
// One place for what a call's outcome becomes when a signal arrives (engine state,
// call-log message, ring timeout, agent reject), so the api and worker
// engine-managers and the REST layer cannot disagree.

import type { CallState } from '@multiwa/engines';

export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'rejected' | 'answered_elsewhere' | 'unknown';
export type CallFollowUp = 'open' | 'in_progress' | 'done';
export type CallRejectedBy = 'auto' | 'agent' | 'device';
/** Who ended a call answered in the dashboard (calls.endedBy). */
export type CallEndedBy = 'agent' | 'caller' | 'server';
/** Why it ended (calls.endReason). */
export type CallEndReason = 'hangup' | 'caller_hangup' | 'agent_lost' | 'media_failed' | 'time_limit' | 'server_restart';

export const CALL_OUTCOMES: readonly CallOutcome[] = ['ringing', 'answered', 'missed', 'rejected', 'answered_elsewhere', 'unknown'];
export const CALL_FOLLOW_UPS: readonly CallFollowUp[] = ['open', 'in_progress', 'done'];

// `answered` (in the dashboard) is final like the phase-1 outcomes: the call log WhatsApp writes when it is over
// ("Completed", mapped to answered_elsewhere) and the engine's `ended` must never overwrite it.
const FINAL: ReadonlySet<CallOutcome> = new Set<CallOutcome>(['answered', 'missed', 'rejected', 'answered_elsewhere']);

/** The outcome an engine state points at; null for the offer itself. */
export function outcomeForState(state: CallState): CallOutcome | null {
  switch (state) {
    case 'accepted': return 'answered_elsewhere';
    case 'rejected': return 'rejected';
    case 'missed': return 'missed';
    case 'ended': return 'unknown';
    default: return null;
  }
}

/**
 * The outcome after a signal, or null when the stored one must stay. Final outcomes
 * never change; `unknown` (it stopped ringing, we do not know how) can still be
 * refined by a final one, typically from the call-log message.
 */
export function nextOutcome(current: CallOutcome, target: CallOutcome): CallOutcome | null {
  if (target === current || target === 'ringing') return null;
  // A call is answered only while it rings: the coordinator's own compare-and-set does it.
  if (target === 'answered' && current !== 'ringing') return null;
  if (FINAL.has(current)) return null;
  if (current === 'unknown' && !FINAL.has(target)) return null;
  return target;
}

/** Follow-up after an outcome change: a call answered (on another device, or in the dashboard) needs nothing more. */
export function followUpAfter(outcome: CallOutcome, current: CallFollowUp): CallFollowUp {
  return (outcome === 'answered_elsewhere' || outcome === 'answered') && current === 'open' ? 'done' : current;
}

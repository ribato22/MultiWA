// MultiWA Admin - call helpers (labels, realtime updates, chat timeline)
// apps/admin/src/lib/calls.ts

import type { CallFollowUp, CallOutcome, CallRecord } from './api';

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  ringing: 'Ringing',
  missed: 'Missed',
  rejected: 'Rejected',
  answered_elsewhere: 'Answered on phone',
  unknown: 'Unknown',
};

export const FOLLOW_UP_LABEL: Record<CallFollowUp, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
};

export type CallFilter = 'open' | 'missed' | 'rejected' | 'all';
export const CALL_FILTERS: { value: CallFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'missed', label: 'Missed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export function filterQuery(f: CallFilter): { followUp?: CallFollowUp; outcome?: CallOutcome } {
  if (f === 'open') return { followUp: 'open' };
  if (f === 'missed') return { outcome: 'missed' };
  if (f === 'rejected') return { outcome: 'rejected' };
  return {};
}

export function matchesFilter(c: CallRecord, f: CallFilter): boolean {
  if (f === 'open') return c.followUp === 'open';
  if (f === 'missed') return c.outcome === 'missed';
  if (f === 'rejected') return c.outcome === 'rejected';
  return true;
}

/** The chat name when known, else the number of the JID. Only a phone JID gets the `+`: an unresolved @lid or a group id is no number. */
export function callerLabel(call: Pick<CallRecord, 'fromJid' | 'conversation'>): string {
  const [local, domain] = call.fromJid.split('@');
  const name = call.conversation?.name;
  // A chat named after the JID or its bare digits (how the backend names a new chat) has no real name.
  if (name && name.split('@')[0] !== local) return name;
  return /^\d+$/.test(local) && (domain === 's.whatsapp.net' || domain === 'c.us') ? `+${local}` : local;
}

/** Socket.IO `call:update` payload (no relations). */
export interface CallUpdatePayload {
  profileId: string;
  callId: string;
  waCallId: string;
  from: string;
  isVideo: boolean;
  isGroup: boolean;
  direction: string;
  outcome: CallOutcome;
  rejectedBy: string | null;
  startedAt: string;
  endedAt: string | null;
  followUp: CallFollowUp;
  assignedUserId: string | null;
}

/** The list row for a payload: `callId` is the row `id` and `from` its `fromJid`; relations the payload lacks come from the previous row. */
export function fromPayload(p: CallUpdatePayload, previous?: CallRecord): CallRecord {
  return {
    conversationId: previous?.conversationId ?? null,
    conversation: previous?.conversation ?? null,
    assignedUser: previous && previous.assignedUserId === p.assignedUserId ? previous.assignedUser : null,
    id: p.callId,
    profileId: p.profileId,
    waCallId: p.waCallId,
    fromJid: p.from,
    isVideo: p.isVideo,
    isGroup: p.isGroup,
    direction: p.direction,
    outcome: p.outcome,
    rejectedBy: p.rejectedBy,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    followUp: p.followUp,
    assignedUserId: p.assignedUserId,
  };
}

/**
 * Apply a realtime update to the list of one profile (newest `startedAt` first, like the API): replace the row,
 * add a new one at its place, drop one that left the filter. The caller passes only the updates of that profile.
 */
export function upsertCall(list: CallRecord[], p: CallUpdatePayload, f: CallFilter): CallRecord[] {
  if (!p?.callId) return list;
  const i = list.findIndex((c) => c.id === p.callId);
  const row = fromPayload(p, i >= 0 ? list[i] : undefined);
  const keep = matchesFilter(row, f);
  if (i >= 0) {
    if (!keep) return list.filter((_, j) => j !== i);
    const next = list.slice();
    next[i] = row; // startedAt never changes, so the row keeps its place
    return next;
  }
  if (!keep) return list;
  // Not always the newest: a call logged late (the phone was offline) starts before rows already listed.
  const at = list.findIndex((c) => Date.parse(row.startedAt) > Date.parse(c.startedAt));
  return at < 0 ? [...list, row] : [...list.slice(0, at), row, ...list.slice(at)];
}

/** A call shown in the chat timeline. */
export interface CallTimelineEntry {
  id: string;
  type: 'call';
  timestamp: string;
  call: CallRecord;
}

export function isCallEntry(x: unknown): x is CallTimelineEntry {
  return !!x && typeof x === 'object' && (x as CallTimelineEntry).type === 'call' && 'call' in (x as object);
}

/** Merge calls into a time-ordered message list; while `hasOlder` (older messages still unloaded), calls older than the oldest loaded message are left out. */
export function mergeTimeline<T extends { timestamp: string }>(messages: T[], calls: CallRecord[], hasOlder = true): Array<T | CallTimelineEntry> {
  const oldest = hasOlder && messages.length ? Date.parse(messages[0].timestamp) : -Infinity;
  const entries = calls
    .filter((c) => Date.parse(c.startedAt) >= oldest)
    .map((c): CallTimelineEntry => ({ id: `call:${c.id}`, type: 'call', timestamp: c.startedAt, call: c }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!entries.length) return messages;
  const out: Array<T | CallTimelineEntry> = [];
  let j = 0;
  for (const m of messages) {
    while (j < entries.length && Date.parse(entries[j].timestamp) <= Date.parse(m.timestamp)) out.push(entries[j++]);
    out.push(m);
  }
  while (j < entries.length) out.push(entries[j++]);
  return out;
}

// MultiWA Admin - call helpers (labels, realtime updates, chat timeline)
// apps/admin/src/lib/calls.ts

import type { CallEndReason, CallFollowUp, CallOutcome, CallRecord } from './api';

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  ringing: 'Ringing',
  answered: 'Answered',
  missed: 'Missed',
  rejected: 'Rejected',
  answered_elsewhere: 'Answered on phone',
  unknown: 'Unknown',
};

/** The outcome to show: a newer API can send one this admin does not know yet (the column is plain text), shown as unknown. */
export const knownOutcome = (outcome: string): CallOutcome =>
  Object.prototype.hasOwnProperty.call(OUTCOME_LABEL, outcome) ? (outcome as CallOutcome) : 'unknown';

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

/** A call's length: m:ss, and h:mm:ss past an hour; a negative or non-finite length reads 0:00. */
export function formatDuration(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The banner's caller: the chat name when it is a name, else the number; a caller WhatsApp hides (a LID) has none.
 * A chat named after its number or its JID (how the backend names a new chat) has no name.
 */
export function ringingCallerLabel(caller: { name: string | null; number: string | null }): string {
  if (caller.name && !/^\+?\d+(@[\w.]+)?$/.test(caller.name)) return caller.name;
  return caller.number ? `+${caller.number}` : 'Unknown number';
}

const WA_CHANGED = 'WhatsApp Web changed, or is still loading';
/** Why a profile cannot take calls in the dashboard (the settings checklist), or why a banner says "answer on the phone": the cause only. */
export const READINESS_TEXT: Record<string, string> = {
  engine_host_worker: 'This server is not set up for calls in the dashboard: ask your administrator',
  media_disabled: 'Calls in the dashboard are turned off on the server: ask your administrator',
  media_server_down: 'The call media server is down: ask your administrator',
  auto_reject_on: 'Auto-reject is on for this profile: turn it off',
  profile_not_connected: 'The profile is not connected',
  engine_not_supported: 'The profile’s engine cannot take calls: switch it to whatsapp-web.js',
  not_ready: 'WhatsApp Web is still loading',
  web_calling_disabled: 'WhatsApp has not enabled calling on WhatsApp Web for this number',
  voip_stack_unavailable: WA_CHANGED,
  module_missing: WA_CHANGED,
  hooks_missing: WA_CHANGED,
  not_prepared: WA_CHANGED,
  page_error: WA_CHANGED,
  video_call: 'Video calls can’t be answered in the dashboard',
  group_call: 'Group calls can’t be answered in the dashboard',
};

/** The reasons a calls setting or the announcement was refused (a 409's `reasons`). */
export const SETTINGS_REASON_TEXT: Record<string, string> = {
  ...READINESS_TEXT,
  no_announcement: 'Upload an announcement first',
  recordings_storage_unset: 'Recording storage is not set up on the server: ask your administrator',
  storage_not_private: 'The recording storage can be read without a login: ask your administrator to make it private',
  storage_check_failed: 'The recording storage could not be checked: try again, or ask your administrator',
  recording_on: 'Turn recording off first',
};

/** A refusal's reasons as texts, each once (several reasons share a text); an unknown reason shows as it came. */
export const reasonTexts = (reasons: string[], texts: Record<string, string> = SETTINGS_REASON_TEXT) => [...new Set(reasons.map((r) => texts[r] ?? r))];

const NO_AUDIO = 'Could not connect audio';

/** Why an answer did not go through (the `call:answer` reply's reason, or no reply). */
export const ANSWER_FAILURE_TEXT: Record<string, string> = {
  not_allowed: 'You cannot answer this call',
  not_ringing: 'The call is no longer ringing',
  already_claimed: 'Someone else answered',
  busy: 'You are already on a call',
  media_unavailable: 'This call cannot be answered here: answer it on the phone',
  media_failed: NO_AUDIO,
  timeout: 'The server did not answer: try again',
  error: 'Something went wrong: try again',
};

// Addressed to the agent who took the call ("You hung up"): only endedText shows these.
const END_REASON_TEXT: Record<CallEndReason, string> = {
  hangup: 'You hung up',
  caller_hangup: 'The caller hung up',
  agent_lost: 'The call dropped: the connection was lost',
  media_failed: 'The call’s audio failed',
  time_limit: 'The call reached its time limit',
  server_restart: 'The server restarted',
};

/**
 * How a call ended, from `call:ended`: null when it only stopped ringing (`{ outcome }`); an end before the audio
 * connected (`{ endReason }` alone); an answered call's end with its talk time (`{ endedBy, endReason, talkSeconds }`).
 */
export function endedText(p: { callId: string; outcome?: string; endedBy?: string; endReason?: string; talkSeconds?: number | null }): string | null {
  if (!p.endReason) return null;
  if (!p.endedBy) return p.endReason === 'media_failed' ? NO_AUDIO : 'The call was not connected';
  const reason = END_REASON_TEXT[p.endReason as CallEndReason] ?? 'Call ended';
  return p.talkSeconds != null && p.talkSeconds > 0 ? `${reason} · ${formatDuration(p.talkSeconds)}` : reason;
}

/** "Answered by Jane · 6 s to answer · Talk 3:12": who took the call, how long it rang for them, how long they talked. */
export function answeredFacts(call: Pick<CallRecord, 'answeredBy' | 'answeredAt' | 'startedAt' | 'talkSeconds'>, name?: string | null): string {
  const parts = [`Answered by ${name ?? call.answeredBy?.name ?? 'an agent'}`];
  if (call.answeredAt) parts.push(`${Math.max(0, Math.round((Date.parse(call.answeredAt) - Date.parse(call.startedAt)) / 1000))} s to answer`);
  if (call.talkSeconds != null) parts.push(`Talk ${formatDuration(call.talkSeconds)}`);
  return parts.join(' · ');
}

export const RECORDING_DELETED_TEXT = {
  retention: 'Recording deleted after its retention period',
  admin: 'Recording deleted by an admin',
} as const;

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
  // Absent from a server older than these fields.
  answeredByUserId?: string | null;
  answeredAt?: string | null;
  endedBy?: CallRecord['endedBy'];
  endReason?: CallRecord['endReason'];
  talkSeconds?: number | null;
  /** Sent once, when the call's recording is stored: read the call again for its facts. */
  hasRecording?: true;
}

/** The list row for a payload: `callId` is the row `id` and `from` its `fromJid`; relations the payload lacks come from the previous row. */
export function fromPayload(p: CallUpdatePayload, previous?: CallRecord): CallRecord {
  return {
    conversationId: previous?.conversationId ?? null,
    conversation: previous?.conversation ?? null,
    assignedUser: previous && previous.assignedUserId === p.assignedUserId ? previous.assignedUser : null,
    answeredBy: previous && previous.answeredByUserId === p.answeredByUserId ? previous.answeredBy : null,
    recording: previous?.recording ?? null,
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
    // `?? null`: a payload from a server older than these fields
    answeredByUserId: p.answeredByUserId ?? null,
    answeredAt: p.answeredAt ?? null,
    endedBy: p.endedBy ?? null,
    endReason: p.endReason ?? null,
    talkSeconds: p.talkSeconds ?? null,
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

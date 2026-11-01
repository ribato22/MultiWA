// MultiWA Gateway API - Internal diagnostic events
// apps/api/src/metrics/internal-events.ts
//
// Event names published on the same EventEmitter2 bus as AppEvents, but
// DELIBERATELY NOT part of AppEvents/APP_EVENT_SET. WebhookDispatcher.dispatch()
// drops anything outside APP_EVENT_SET, so these stay internal telemetry and can
// never be delivered to a customer webhook.
//
// They exist because the two failures behind the 2026-07-30 incident were both
// SILENT: whatsapp-web.js's group Store broke (every getChats/getGroups threw, so
// the group list quietly degraded to DB rows) and delivery acks arrived with no
// resolvable message id (so every outbound row froze at `pending`). Neither moved
// a metric, so monitoring could not see them — a user reported them ~10 days later.
// Surfacing both as counters is what turns the next occurrence into an alert.

import type { CallState } from '@multiwa/engines';
import type { CallEndReason } from '@multiwa/engine-runtime';

export const InternalEvents = {
  /**
   * Emitted once per group-list fetch with `source: 'live' | 'fallback'`.
   * `fallback` means the live engine call failed and the DB fallback served the
   * request — i.e. the engine's chat Store is degraded.
   */
  ENGINE_GROUP_FETCH: 'internal.engine.group_fetch',

  /**
   * Emitted when a delivery ack could not be applied because it carried no
   * resolvable message id — the signature of a WhatsApp Web key rename.
   */
  ENGINE_ACK_DROPPED: 'internal.engine.ack_dropped',

  /**
   * Emitted when the call media server's mediasoup worker dies: every call it carried lost its media, and the
   * service starts a new worker. Any occurrence is worth an alert.
   */
  CALLS_MEDIA_WORKER_DIED: 'internal.calls_media.worker_died',

  /**
   * Every call signal of an engine hosted in this process (`state` 'ringing' for an offer), for the call coordinator:
   * whatsapp-web.js reports a call answered in the dashboard as `ended` when it is over, which no longer moves the
   * stored outcome (answered is final), so nothing else would tell the coordinator the caller hung up.
   */
  CALL_ENGINE_SIGNAL: 'internal.calls.engine_signal',

  /** A user's first dashboard socket (a JWT login; API-key sockets do not count) joined /ws. */
  WS_USER_ONLINE: 'internal.ws.user_online',

  /** A user's last dashboard socket left /ws: the call coordinator starts the agent-lost grace of their call. */
  WS_USER_OFFLINE: 'internal.ws.user_offline',

  /** The call coordinator, for the counters: a call offered to agents, answered, a media failure, an answered call ended. */
  CALLS_SESSION: 'internal.calls.session',

  /** The privacy check of the call recordings storage ran (CallRecordingsService.checkStorage), with its result. */
  CALL_RECORDINGS_PRIVACY: 'internal.calls.recordings_privacy',

  /** The call recorder, for the counters: a recording stored or not, a call left unrecorded and why. */
  CALL_RECORDER: 'internal.calls.recorder',
} as const;

export interface EngineGroupFetchPayload {
  profileId: string;
  source: 'live' | 'fallback';
  /** Number of groups returned (0 is legitimate — a profile may have no groups). */
  count: number;
}

export interface EngineAckDroppedPayload {
  profileId: string;
  status: string;
}

export interface CallsMediaWorkerDiedPayload {
  /** Calls whose media the dead worker carried. */
  calls: number;
}

export interface CallEngineSignalPayload {
  profileId: string;
  /** The engine's call id (calls.waCallId). */
  waCallId: string;
  state: CallState;
}

export interface WsUserPayload {
  userId: string;
}

/** Why the audio of a call answered in the dashboard did not connect, or broke (the media-failure counter's label). */
export type CallMediaFailureReason =
  | 'page_start_failed'
  | 'connect_timeout'
  | 'answer_failed'
  | 'attach_failed'
  | 'agent_connect_failed'
  | 'worker_died'
  | 'engine_lost';

// Closed label sets: a counter's series cannot multiply on a typo.
export type CallsSessionPayload =
  | { kind: 'rung' }
  | { kind: 'answered'; answerSeconds: number }
  | { kind: 'media_failed'; reason: CallMediaFailureReason }
  | { kind: 'ended'; endReason: CallEndReason };

/** `not_private`: anyone can read the recordings. `check_failed`: the check proved nothing. */
export interface CallRecordingsPrivacyPayload {
  result: 'ok' | 'not_private' | 'check_failed';
}

/** `upload`: a recording's storing ended (after its tries, or a leftover's one). `failed`: a call left unrecorded. */
export type CallRecorderPayload =
  | { kind: 'upload'; result: 'ok' | 'failed' }
  | { kind: 'failed'; stage: 'start' | 'announcement' };

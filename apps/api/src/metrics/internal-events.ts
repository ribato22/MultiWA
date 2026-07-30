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

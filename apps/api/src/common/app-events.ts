// MultiWA Gateway - Canonical application event names
// apps/api/src/common/app-events.ts
//
// Single source of truth for the dot-namespaced event names published on the
// EventEmitter2 bus (delimiter '.'). These are the names webhook subscribers
// filter on (Webhook.events) and that the WebhookDispatcher matches against.
//
// IMPORTANT: these DOT names are distinct from the Socket.IO COLON channel names
// (e.g. 'message:received', 'qr:update') emitted by EventsGateway. Do not
// conflate them — the webhook `events: { has: event }` filter only matches the
// dot names below.

export const AppEvents = {
  MESSAGE: {
    RECEIVED: 'message.received',
    SENT: 'message.sent',
    DELIVERED: 'message.delivered',
    READ: 'message.read',
    FAILED: 'message.failed',
  },
  CONNECTION: {
    UPDATE: 'connection.update',
    QR: 'connection.qr',
    READY: 'connection.ready',
    DISCONNECTED: 'connection.disconnected',
  },
  GROUP: {
    JOIN: 'group.join',
    LEAVE: 'group.leave',
    MESSAGE: 'group.message',
  },
  CONTACT: {
    UPDATE: 'contact.update',
  },
} as const;

// Recursively extract the leaf string-literal values (the event names).
type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];

/** Union of every canonical dot-namespaced event name. */
export type AppEventName = Leaves<typeof AppEvents>;

/** Flat list of every canonical event name. */
export const ALL_APP_EVENTS: readonly AppEventName[] = Object.values(AppEvents).flatMap(
  (group) => Object.values(group) as AppEventName[],
);

/** O(1) membership set used by the WebhookDispatcher to skip unknown events. */
export const APP_EVENT_SET: ReadonlySet<string> = new Set(ALL_APP_EVENTS);

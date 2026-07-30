// Locks the engine-degradation probes added after the 2026-07-30 incident, where a
// WhatsApp Web message-key rename silently broke the chat Store (group list quietly
// degraded to DB rows) and delivery acks (every outbound row froze at `pending`).
// Both failures moved NO metric, so monitoring was blind for ~10 days. These tests
// assert the counters move on the failure paths — and that the internal event names
// can never reach a customer webhook.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsEventsListener } from './metrics-events.listener';
import { InternalEvents } from './internal-events';
import { ALL_APP_EVENTS } from '@multiwa/core';

const makeMetrics = () => ({
  messagesSentTotal: { inc: vi.fn() },
  messagesFailedTotal: { inc: vi.fn() },
  connectedProfiles: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
  engineGroupFetchTotal: { inc: vi.fn() },
  engineAckDroppedTotal: { inc: vi.fn() },
});

describe('engine-degradation probes', () => {
  let metrics: ReturnType<typeof makeMetrics>;
  let listener: MetricsEventsListener;

  beforeEach(() => {
    metrics = makeMetrics();
    listener = new MetricsEventsListener(metrics as any);
  });

  describe('group-fetch source', () => {
    it('counts a live fetch as source="live"', () => {
      listener.onEngineGroupFetch({ profileId: 'p1', source: 'live', count: 12 });
      expect(metrics.engineGroupFetchTotal.inc).toHaveBeenCalledWith({ source: 'live' });
    });

    // THE alert signal: the live engine call failed and stored groups were served.
    it('counts a DB fallback as source="fallback"', () => {
      listener.onEngineGroupFetch({ profileId: 'p1', source: 'fallback', count: 25 });
      expect(metrics.engineGroupFetchTotal.inc).toHaveBeenCalledWith({ source: 'fallback' });
    });

    // A profile legitimately having zero groups must NOT look like degradation —
    // that is why the probe keys on the SOURCE, not on the group/participant count.
    it('still reports source="live" when a profile genuinely has no groups', () => {
      listener.onEngineGroupFetch({ profileId: 'p1', source: 'live', count: 0 });
      expect(metrics.engineGroupFetchTotal.inc).toHaveBeenCalledWith({ source: 'live' });
    });

    it('degrades to source="unknown" rather than throwing on a malformed payload', () => {
      listener.onEngineGroupFetch({} as any);
      expect(metrics.engineGroupFetchTotal.inc).toHaveBeenCalledWith({ source: 'unknown' });
    });
  });

  describe('dropped acks', () => {
    it('counts an ack that carried no resolvable message id', () => {
      listener.onEngineAckDropped({ profileId: 'p1', status: 'read' });
      expect(metrics.engineAckDroppedTotal.inc).toHaveBeenCalledOnce();
    });
  });

  describe('telemetry must never break the request path', () => {
    it('swallows a metrics backend failure', () => {
      metrics.engineGroupFetchTotal.inc.mockImplementation(() => { throw new Error('registry exploded'); });
      metrics.engineAckDroppedTotal.inc.mockImplementation(() => { throw new Error('registry exploded'); });
      expect(() => listener.onEngineGroupFetch({ profileId: 'p', source: 'live', count: 1 })).not.toThrow();
      expect(() => listener.onEngineAckDropped({ profileId: 'p', status: 'sent' })).not.toThrow();
    });
  });

  // WebhookDispatcher.dispatch() only forwards events in APP_EVENT_SET. Keeping these
  // names OUT of AppEvents is what guarantees internal telemetry is never delivered
  // to a customer endpoint — assert it so a future refactor can't quietly leak them.
  describe('internal events are not customer-facing', () => {
    it('is absent from the canonical webhook event list', () => {
      for (const name of Object.values(InternalEvents)) {
        expect(ALL_APP_EVENTS).not.toContain(name as any);
        expect(name.startsWith('internal.')).toBe(true);
      }
    });
  });
});

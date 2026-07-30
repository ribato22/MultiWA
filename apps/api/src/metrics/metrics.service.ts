// MultiWA Gateway API - Metrics Service
// apps/api/src/metrics/metrics.service.ts
//
// Owns a dedicated prom-client Registry (not the global one) so tests and
// multiple instantiations stay isolated. Collects default Node/process metrics
// (CPU, memory, event-loop lag, GC, handles) plus the HTTP RED series
// (requests + latency) recorded by HttpMetricsInterceptor. Domain metrics can be
// added by injecting this service and registering on `registry` via getOrCreate.

import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry, Counter, Histogram, Gauge, Metric } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // HTTP RED (Rate / Errors / Duration). Labelled by the matched ROUTE PATTERN
  // (e.g. /api/v1/messages/:id), never the raw URL, so cardinality stays bounded.
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;

  // Domain metrics. Incremented by MetricsEventsListener off the EventEmitter bus
  // (never on the send hot path). `type` = message type (text/image/…).
  readonly messagesSentTotal: Counter<'type'>;
  readonly messagesFailedTotal: Counter<'type'>;
  // Approximate live count of connected WhatsApp profiles: resynced from the DB at
  // startup, then adjusted by connection.ready / connection.disconnected events.
  readonly connectedProfiles: Gauge;

  // Engine-degradation probes. Both failures behind the 2026-07-30 incident were
  // silent — the group Store broke (list quietly served from the DB fallback) and
  // acks lost their message id (every outbound row froze at `pending`) — so
  // monitoring saw nothing for ~10 days. These make the next occurrence alertable.
  // `source="fallback"` on any sustained rate means the live chat Store is broken.
  readonly engineGroupFetchTotal: Counter<'source'>;
  readonly engineAckDroppedTotal: Counter;

  constructor() {
    this.registry.setDefaultLabels({ app: 'multiwa-api' });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = this.getOrCreate(
      'http_requests_total',
      () =>
        new Counter({
          name: 'http_requests_total',
          help: 'Total HTTP requests by method, matched route pattern, and status code',
          labelNames: ['method', 'route', 'status'] as const,
          registers: [this.registry],
        }),
    );

    this.httpRequestDuration = this.getOrCreate(
      'http_request_duration_seconds',
      () =>
        new Histogram({
          name: 'http_request_duration_seconds',
          help: 'HTTP request latency (seconds) by method, matched route pattern, and status code',
          labelNames: ['method', 'route', 'status'] as const,
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
          registers: [this.registry],
        }),
    );

    this.messagesSentTotal = this.getOrCreate(
      'multiwa_messages_sent_total',
      () =>
        new Counter({
          name: 'multiwa_messages_sent_total',
          help: 'WhatsApp messages sent successfully, by message type',
          labelNames: ['type'] as const,
          registers: [this.registry],
        }),
    );

    this.messagesFailedTotal = this.getOrCreate(
      'multiwa_messages_failed_total',
      () =>
        new Counter({
          name: 'multiwa_messages_failed_total',
          help: 'WhatsApp message sends that failed, by message type',
          labelNames: ['type'] as const,
          registers: [this.registry],
        }),
    );

    this.connectedProfiles = this.getOrCreate(
      'multiwa_connected_profiles',
      () =>
        new Gauge({
          name: 'multiwa_connected_profiles',
          help: 'WhatsApp profiles currently connected (approximate)',
          registers: [this.registry],
        }),
    );

    this.engineGroupFetchTotal = this.getOrCreate(
      'multiwa_engine_group_fetch_total',
      () =>
        new Counter({
          name: 'multiwa_engine_group_fetch_total',
          help:
            'Group-list fetches by source. source="fallback" means the live engine ' +
            'call failed and stored groups were served — the engine chat Store is degraded.',
          labelNames: ['source'] as const,
          registers: [this.registry],
        }),
    );

    this.engineAckDroppedTotal = this.getOrCreate(
      'multiwa_engine_ack_dropped_total',
      () =>
        new Counter({
          name: 'multiwa_engine_ack_dropped_total',
          help:
            'Delivery acks discarded because they carried no resolvable message id — ' +
            'the signature of a WhatsApp Web message-key rename. Sustained non-zero ' +
            'means outbound message status is frozen.',
          registers: [this.registry],
        }),
    );
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  // Reuse an existing series on re-instantiation (Vitest re-import, Nest HMR)
  // instead of throwing "A metric with the name ... has already been registered".
  private getOrCreate<T extends Metric>(name: string, factory: () => T): T {
    return (this.registry.getSingleMetric(name) as T | undefined) ?? factory();
  }
}

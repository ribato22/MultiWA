// MultiWA Gateway API - Metrics Service
// apps/api/src/metrics/metrics.service.ts
//
// Owns a dedicated prom-client Registry (not the global one) so tests and
// multiple instantiations stay isolated. Collects default Node/process metrics
// (CPU, memory, event-loop lag, GC, handles) plus the HTTP RED series
// (requests + latency) recorded by HttpMetricsInterceptor. Domain metrics can be
// added by injecting this service and registering on `registry` via getOrCreate.

import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry, Counter, Histogram, Metric } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // HTTP RED (Rate / Errors / Duration). Labelled by the matched ROUTE PATTERN
  // (e.g. /api/v1/messages/:id), never the raw URL, so cardinality stays bounded.
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;

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

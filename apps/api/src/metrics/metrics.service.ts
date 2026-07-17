// MultiWA Gateway API - Metrics Service
// apps/api/src/metrics/metrics.service.ts
//
// Owns a dedicated prom-client Registry (not the global one) so tests and
// multiple instantiations stay isolated. Collects default Node/process metrics
// (CPU, memory, event-loop lag, GC, handles). Domain metrics can be added by
// injecting this service and registering on `registry`.

import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  constructor() {
    this.registry.setDefaultLabels({ app: 'multiwa-api' });
    collectDefaultMetrics({ register: this.registry });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

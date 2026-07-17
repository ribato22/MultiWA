// MetricsService tests — verifies the /metrics payload is valid Prometheus text
// with default runtime metrics on an isolated registry.

import { describe, it, expect } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders default Node/process metrics in Prometheus exposition format', async () => {
    const svc = new MetricsService();
    const out = await svc.metrics();
    expect(out).toContain('process_cpu_user_seconds_total');
    expect(out).toContain('nodejs_heap_size_total_bytes');
    expect(out).toContain('nodejs_eventloop_lag_seconds');
    // Default label applied to every series.
    expect(out).toContain('app="multiwa-api"');
    // Exposition format has HELP/TYPE comment lines.
    expect(out).toMatch(/# TYPE process_cpu_user_seconds_total counter/);
  });

  it('advertises the Prometheus text content type', () => {
    const svc = new MetricsService();
    expect(svc.registry.contentType).toContain('text/plain');
    expect(svc.registry.contentType).toContain('version=0.0.4');
  });
});

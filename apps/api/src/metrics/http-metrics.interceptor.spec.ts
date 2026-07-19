// Unit tests for HttpMetricsInterceptor — proves route-pattern labelling,
// endpoint exclusion, and error-status capture against a real MetricsService.

import { describe, it, expect, beforeEach } from 'vitest';
import { of, throwError, lastValueFrom } from 'rxjs';
import { NotFoundException } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

function ctx(route: string, method = 'GET', statusCode = 200) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method, routeOptions: { url: route } }),
      getResponse: () => ({ statusCode }),
    }),
  } as any;
}

describe('HttpMetricsInterceptor', () => {
  let svc: MetricsService;
  let interceptor: HttpMetricsInterceptor;

  beforeEach(() => {
    svc = new MetricsService();
    interceptor = new HttpMetricsInterceptor(svc);
  });

  it('records a matched route by its pattern (not the raw URL)', async () => {
    const handler = { handle: () => of('ok') } as any;
    await lastValueFrom(interceptor.intercept(ctx('/api/v1/messages/:id'), handler));

    const out = await svc.metrics();
    expect(out).toContain('http_requests_total');
    expect(out).toContain('route="/api/v1/messages/:id"');
    expect(out).toContain('status="200"');
    expect(out).toContain('http_request_duration_seconds');
  });

  it('excludes the /metrics and /health endpoints', async () => {
    const handler = { handle: () => of('ok') } as any;
    await lastValueFrom(interceptor.intercept(ctx('/metrics'), handler));
    await lastValueFrom(interceptor.intercept(ctx('/api/v1/health'), handler));

    const out = await svc.metrics();
    expect(out).not.toContain('route="/metrics"');
    expect(out).not.toContain('route="/api/v1/health"');
  });

  it('captures the HttpException status on error', async () => {
    const handler = { handle: () => throwError(() => new NotFoundException()) } as any;
    await expect(
      lastValueFrom(interceptor.intercept(ctx('/api/v1/messages/:id'), handler)),
    ).rejects.toThrow(NotFoundException);

    const out = await svc.metrics();
    expect(out).toContain('status="404"');
  });
});

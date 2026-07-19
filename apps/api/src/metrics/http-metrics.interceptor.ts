// MultiWA Gateway API - HTTP RED metrics interceptor
// apps/api/src/metrics/http-metrics.interceptor.ts
//
// Records http_requests_total + http_request_duration_seconds for every matched
// HTTP route, labelled by the ROUTE PATTERN (bounded cardinality). Additive and
// fully guarded: a metrics bug can never break a response.

import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

// Prefix-agnostic: matches /metrics, /api/v1/health, /api/v1/health/ready.
// These are scrape/probe endpoints and would only add noise to the RED series.
const EXCLUDED = /\/(metrics|health)(\/.*)?$/;

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpMetricsInterceptor.name);

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle(); // skip WS / socket.io gateways
    }

    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    // The matched template (e.g. /api/v1/messages/:id), NOT the raw URL.
    const route = req.routeOptions?.url ?? 'unknown';
    if (EXCLUDED.test(route)) {
      return next.handle();
    }

    const method = req.method;
    const start = process.hrtime.bigint();

    const record = (status: number) => {
      try {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        const labels = { method, route, status: String(status) };
        this.metrics.httpRequestsTotal.inc(labels);
        this.metrics.httpRequestDuration.observe(labels, seconds);
      } catch (err) {
        // Never let a metrics failure affect the response.
        this.logger.debug(`metrics record failed: ${(err as Error).message}`);
      }
    };

    return next.handle().pipe(
      // Nest sets the final status BEFORE interceptors run on success, so
      // reply.statusCode is correct here. On error the exception filter sets the
      // status later, so read it from the thrown HttpException instead.
      tap(() => record(reply.statusCode)),
      catchError((err) => {
        record(err instanceof HttpException ? err.getStatus() : 500);
        return throwError(() => err);
      }),
    );
  }
}

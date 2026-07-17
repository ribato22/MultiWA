// MultiWA Gateway API - Metrics Controller
// apps/api/src/metrics/metrics.controller.ts
//
// Exposes Prometheus metrics at GET /metrics (excluded from the /api/v1 global
// prefix in main.ts, so it lives at the conventional root path). Public, like
// /health — restrict access at your reverse proxy / firewall in production.

import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { MetricsService } from './metrics.service';

@Controller()
@SkipThrottle()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @ApiExcludeEndpoint()
  async getMetrics(@Res() reply: FastifyReply) {
    reply.header('Content-Type', this.metricsService.registry.contentType);
    reply.send(await this.metricsService.metrics());
  }
}

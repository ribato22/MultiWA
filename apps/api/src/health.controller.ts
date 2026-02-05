// MultiWA Gateway API - Health Controller
// apps/api/src/health.controller.ts

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { prisma } from '@multiwa/database';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'API is healthy' })
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      service: 'multiwa-gateway-api',
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({ status: 200, description: 'API is ready' })
  @ApiResponse({ status: 503, description: 'API is not ready' })
  async ready(@Res() reply: FastifyReply) {
    const checks: Record<string, string> = {};
    let allHealthy = true;

    // Check database connectivity
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      allHealthy = false;
    }

    // Check Redis connectivity (via environment)
    try {
      const redisUrl = process.env.REDIS_URL;
      checks.redis = redisUrl ? 'configured' : 'not_configured';
    } catch {
      checks.redis = 'error';
      allHealthy = false;
    }

    const statusCode = allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return reply.status(statusCode).send({
      status: allHealthy ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  }
}

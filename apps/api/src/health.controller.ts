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

    // Check Redis connectivity with an actual PING (not just env presence).
    // Short-lived client, bounded connect timeout, disconnected in finally so a
    // probe every ~30s never leaks sockets or hangs the endpoint.
    {
      const IORedis = (await import('ioredis')).default;
      const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
        connectTimeout: 1500,
      });
      redis.on('error', () => {}); // swallow background errors; the ping result decides
      try {
        await redis.connect();
        checks.redis = (await redis.ping()) === 'PONG' ? 'ok' : 'error';
      } catch {
        checks.redis = 'error';
      } finally {
        redis.disconnect();
      }
      if (checks.redis !== 'ok') allHealthy = false;
    }

    const statusCode = allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return reply.status(statusCode).send({
      status: allHealthy ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  }
}

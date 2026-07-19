// MultiWA Gateway API - Metrics Module
// apps/api/src/metrics/metrics.module.ts

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsEventsListener } from './metrics-events.listener';

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    // Global HTTP RED interceptor. MetricsModule is imported first in AppModule,
    // so this is the outermost interceptor and measures total handler time.
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    // Domain metrics from the EventEmitter bus (messages sent/failed, connected profiles).
    MetricsEventsListener,
  ],
  exports: [MetricsService],
})
export class MetricsModule {}

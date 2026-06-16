// MultiWA Gateway - Worker engine Nest module
// apps/worker/src/engine/worker-engine.module.ts
//
// The Nest application context the worker bootstraps when ENGINE_HOST=worker. It
// provides the event bus, scheduler, and the RealtimeEmitter (Redis publisher)
// that the relocated engine services depend on. The engine services
// (EngineManager, RuleEngine, Messages, Notifications, AI) plug in here as they
// move into @multiwa/engine-runtime. See architecture/engine-worker-migration-sop.md.

import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { REALTIME_EMITTER } from '@multiwa/core';
import { SendGateService } from '@multiwa/engine-runtime';
import { RealtimePublisherService } from './realtime-publisher.service';

@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    RealtimePublisherService,
    // The engine emits realtime events via the Redis publisher in the worker.
    { provide: REALTIME_EMITTER, useExisting: RealtimePublisherService },
    // Shared send gate (per-profile pacing + daily limit) used by the worker send path.
    SendGateService,
  ],
  exports: [RealtimePublisherService, SendGateService],
})
export class WorkerEngineModule {}

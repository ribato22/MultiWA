// MultiWA Gateway API - Domain metrics event listener
// apps/api/src/metrics/metrics-events.listener.ts
//
// Bridges the in-process EventEmitter bus to Prometheus counters/gauge. Runs off
// the send hot path (event handlers) and every handler is guarded, so a metrics
// error can never affect message delivery or connection handling.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { MetricsService } from './metrics.service';
import {
  InternalEvents,
  type CallRecordingsPrivacyPayload,
  type CallsMediaWorkerDiedPayload,
  type CallsSessionPayload,
  type EngineAckDroppedPayload,
  type EngineGroupFetchPayload,
} from './internal-events';

@Injectable()
export class MetricsEventsListener implements OnModuleInit {
  private readonly logger = new Logger(MetricsEventsListener.name);

  constructor(private readonly metrics: MetricsService) {}

  // Resync the connected-profiles gauge from the source of truth at startup so a
  // process restart doesn't leave it stuck at 0 until profiles reconnect.
  async onModuleInit(): Promise<void> {
    try {
      const connected = await prisma.profile.count({ where: { status: 'connected' } });
      this.metrics.connectedProfiles.set(connected);
    } catch (err) {
      this.logger.debug(`connected-profiles resync failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(AppEvents.MESSAGE.SENT)
  onMessageSent(payload: { type?: string }): void {
    try {
      this.metrics.messagesSentTotal.inc({ type: payload?.type ?? 'unknown' });
    } catch (err) {
      this.logger.debug(`messagesSent metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(AppEvents.MESSAGE.FAILED)
  onMessageFailed(payload: { type?: string }): void {
    try {
      this.metrics.messagesFailedTotal.inc({ type: payload?.type ?? 'unknown' });
    } catch (err) {
      this.logger.debug(`messagesFailed metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(AppEvents.CONNECTION.READY)
  onConnectionReady(): void {
    try {
      this.metrics.connectedProfiles.inc();
    } catch (err) {
      this.logger.debug(`connectedProfiles.inc failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(AppEvents.CONNECTION.DISCONNECTED)
  onConnectionDisconnected(): void {
    try {
      this.metrics.connectedProfiles.dec();
    } catch (err) {
      this.logger.debug(`connectedProfiles.dec failed: ${(err as Error).message}`);
    }
  }

  // Engine-degradation probes (internal events — never delivered to webhooks).
  @OnEvent(InternalEvents.ENGINE_GROUP_FETCH)
  onEngineGroupFetch(payload: EngineGroupFetchPayload): void {
    try {
      this.metrics.engineGroupFetchTotal.inc({ source: payload?.source ?? 'unknown' });
    } catch (err) {
      this.logger.debug(`engineGroupFetch metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(InternalEvents.ENGINE_ACK_DROPPED)
  onEngineAckDropped(_payload: EngineAckDroppedPayload): void {
    try {
      this.metrics.engineAckDroppedTotal.inc();
    } catch (err) {
      this.logger.debug(`engineAckDropped metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(InternalEvents.CALLS_MEDIA_WORKER_DIED)
  onCallsMediaWorkerDied(_payload: CallsMediaWorkerDiedPayload): void {
    try {
      this.metrics.callsMediaWorkerDeathsTotal.inc();
    } catch (err) {
      this.logger.debug(`callsMediaWorkerDied metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(InternalEvents.CALLS_SESSION)
  onCallsSession(payload: CallsSessionPayload): void {
    try {
      switch (payload.kind) {
        case 'rung':
          this.metrics.callsDashboardRingsTotal.inc();
          break;
        case 'answered':
          this.metrics.callsDashboardAnswersTotal.inc();
          this.metrics.callsDashboardAnswerSeconds.observe(payload.answerSeconds);
          break;
        case 'media_failed':
          this.metrics.callsMediaFailuresTotal.inc({ reason: payload.reason });
          break;
        case 'ended':
          this.metrics.callsDashboardEndedTotal.inc({ reason: payload.endReason });
          break;
      }
    } catch (err) {
      this.logger.debug(`callsSession metric failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(InternalEvents.CALL_RECORDINGS_PRIVACY)
  onCallRecordingsPrivacy(payload: CallRecordingsPrivacyPayload): void {
    try {
      this.metrics.callsRecordingsPrivacyChecksTotal.inc({ result: payload.result });
    } catch (err) {
      this.logger.debug(`callRecordingsPrivacy metric failed: ${(err as Error).message}`);
    }
  }
}

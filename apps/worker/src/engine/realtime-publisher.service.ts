// MultiWA Gateway - Worker realtime publisher
// apps/worker/src/engine/realtime-publisher.service.ts
//
// The worker-side RealtimeEmitter: when ENGINE_HOST=worker the engine runs here,
// so its realtime events (QR / connection / message / ack) are published to the
// Redis channel multiwa:realtime. The API's RealtimeBridgeService subscribes and
// re-emits them through Socket.IO. See architecture/realtime-bridge-sop.md.

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { REALTIME_CHANNEL, RealtimeEmitter, RealtimeMessage } from '@multiwa/core';

@Injectable()
export class RealtimePublisherService implements RealtimeEmitter, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimePublisherService.name);
  private readonly publisher: IORedis;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor() {
    this.publisher = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  onModuleInit(): void {
    // Heartbeat so the API can detect a dead worker (RealtimeBridge logs if stale).
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', profileId: '*', payload: { ts: Date.now(), workerPid: process.pid } });
    }, 30_000);
    this.logger.log(`Realtime publisher ready (channel ${REALTIME_CHANNEL})`);
  }

  // --- RealtimeEmitter (same method shapes as the API EventsGateway) ---
  emitQrUpdate(profileId: string, qrCode: string): void {
    this.send({ type: 'qr:update', profileId, payload: { qrCode } });
  }
  emitConnectionStatus(profileId: string, status: string, phoneOrReason?: string): void {
    this.send({ type: 'connection:status', profileId, payload: { status, phoneOrReason } });
  }
  emitMessage(profileId: string, message: any): void {
    this.send({ type: 'message', profileId, payload: message });
  }
  emitMessageAck(profileId: string, messageId: string, status: string): void {
    this.send({ type: 'message:ack', profileId, payload: { messageId, status } });
  }

  private send(msg: RealtimeMessage): void {
    // Fire-and-forget: never let a publish error disrupt the engine callback.
    this.publisher.publish(REALTIME_CHANNEL, JSON.stringify(msg)).catch((err) =>
      this.logger.warn(`realtime publish failed: ${(err as Error).message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await this.publisher.quit();
  }
}

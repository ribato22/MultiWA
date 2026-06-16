// MultiWA Gateway - Realtime Bridge (worker -> API)
// apps/api/src/modules/events/realtime-bridge.service.ts
//
// When ENGINE_HOST=worker the engine runs in apps/worker, which publishes QR /
// connection / message / ack events to the Redis channel multiwa:realtime. This
// service subscribes on a dedicated ioredis connection and re-emits them through
// the Socket.IO EventsGateway so browser clients keep receiving realtime updates.
// Idle (no Redis connection) when ENGINE_HOST=api. See architecture/engine-worker-migration-sop.md.

import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { REALTIME_CHANNEL, RealtimeMessage } from '@multiwa/core';
import { EventsGateway } from './events.gateway';
import { isWorkerEngine } from '../../common/engine-host';

const HEARTBEAT_STALE_MS = 90_000;

@Injectable()
export class RealtimeBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBridgeService.name);
  private subscriber?: IORedis;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastHeartbeat = 0;

  constructor(
    private readonly config: ConfigService,
    @Inject(EventsGateway) private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit(): void {
    if (!isWorkerEngine()) {
      this.logger.log('ENGINE_HOST=api: realtime bridge idle (engine emits in-process)');
      return;
    }

    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    // Dedicated subscriber connection — a subscribed ioredis connection must not
    // also issue regular commands.
    this.subscriber = new IORedis(url, {
      autoResubscribe: true,
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });

    // Subscribe on every 'ready' (initial connect AND after a Redis reconnect),
    // so the subscription survives a Redis restart.
    this.subscriber.on('ready', () => {
      this.subscriber
        ?.subscribe(REALTIME_CHANNEL)
        .then(() => this.logger.log(`Subscribed to ${REALTIME_CHANNEL}`))
        .catch((err) => this.logger.error(`subscribe failed: ${(err as Error).message}`));
    });
    this.subscriber.on('message', (_channel, data) => this.handle(data));
    this.subscriber.on('error', (err) => this.logger.warn(`realtime subscriber error: ${err.message}`));

    this.heartbeatTimer = setInterval(() => {
      if (this.lastHeartbeat && Date.now() - this.lastHeartbeat > HEARTBEAT_STALE_MS) {
        this.logger.error(`No worker realtime heartbeat for ${HEARTBEAT_STALE_MS / 1000}s — realtime events may be lost`);
      }
    }, 30_000);

    this.logger.log('Realtime bridge active (ENGINE_HOST=worker)');
  }

  /** Parse one channel message and re-emit it through the Socket.IO gateway. */
  handle(data: string): void {
    let msg: RealtimeMessage;
    try {
      msg = JSON.parse(data) as RealtimeMessage;
    } catch {
      this.logger.warn('Dropping malformed realtime payload');
      return;
    }
    switch (msg.type) {
      case 'qr:update':
        this.eventsGateway.emitQrUpdate(msg.profileId, msg.payload.qrCode);
        break;
      case 'connection:status':
        this.eventsGateway.emitConnectionStatus(msg.profileId, msg.payload.status, msg.payload.phoneOrReason);
        break;
      case 'message':
        this.eventsGateway.emitMessage(msg.profileId, msg.payload);
        break;
      case 'message:ack':
        this.eventsGateway.emitMessageAck(msg.profileId, msg.payload.messageId, msg.payload.status);
        break;
      case 'heartbeat':
        this.lastHeartbeat = msg.payload.ts;
        break;
      default:
        this.logger.warn(`Unknown realtime message type: ${(msg as any).type}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(REALTIME_CHANNEL);
      } catch {
        /* ignore */
      }
      await this.subscriber.quit();
    }
  }
}

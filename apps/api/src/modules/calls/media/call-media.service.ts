// MultiWA Gateway - the call media server (mediasoup SFU)
// apps/api/src/modules/calls/media/call-media.service.ts
//
// ONE mediasoup Worker and ONE WebRtcServer (a single UDP+TCP port for every media transport) per api process, and
// one CallMediaRoom per call that is being answered. Off unless CALLS_MEDIA_ENABLED=true: then mediasoup is never
// even loaded. A worker that dies closes every room it carried (those calls lost their media); the service tells its
// listeners (`events`: 'worker-died' with the call ids), counts it, and starts a new worker with backoff.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'node:events';
import type { types as ms } from 'mediasoup';
import { InternalEvents, type CallsMediaWorkerDiedPayload } from '../../../metrics/internal-events';
import { CallMediaRoom } from './call-media-room';
import { readCallMediaConfig, type CallMediaConfig, type CallMediaIceServer } from './media-config';

const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const MAX_RESTART_DELAY_MS = 30_000;

/** What /health shows: no addresses (the endpoint is public). */
export interface CallMediaStatus {
  enabled: boolean;
  worker: 'up' | 'down';
  port: number | null;
  announcedAddressSet: boolean;
  activeRooms: number;
}

@Injectable()
export class CallMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallMediaService.name);
  /** 'worker-died' (callIds: string[]): the rooms the dead worker closed. */
  readonly events = new EventEmitter();
  private config: CallMediaConfig | null = null;
  private worker: ms.Worker | null = null;
  private server: ms.WebRtcServer | null = null;
  private readonly rooms = new Map<string, CallMediaRoom>();
  private failedRestarts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async onModuleInit(): Promise<void> {
    this.config = readCallMediaConfig(); // throws on a bad setting: the boot fails with the variable's name
    if (this.config) await this.startWorker();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    for (const room of [...this.rooms.values()]) room.close();
    this.worker?.close();
    this.worker = null;
    this.server = null;
  }

  status(): CallMediaStatus {
    return {
      enabled: !!this.config,
      worker: this.worker ? 'up' : 'down',
      port: this.config?.port ?? null,
      announcedAddressSet: !!this.config?.announcedAddress,
      activeRooms: this.rooms.size,
    };
  }

  /** ICE servers for agents' browsers (CALLS_MEDIA_ICE_SERVERS). */
  iceServers(): CallMediaIceServer[] {
    return this.config?.iceServers ?? [];
  }

  /** The worker's process id, for diagnostics. */
  workerPid(): number | null {
    return this.worker?.pid ?? null;
  }

  /** Open the media room of `callId`: one Router, Opus 48 kHz stereo. One room per call. */
  async createRoom(callId: string): Promise<CallMediaRoom> {
    const worker = this.worker;
    const server = this.server;
    if (!worker || !server) throw new Error('Call media server unavailable');
    if (this.rooms.has(callId)) throw new Error('This call already has a media room');
    const router = await worker.createRouter({ mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }] });
    if (this.worker !== worker || this.rooms.has(callId)) {
      router.close(); // the worker died, or another room opened, meanwhile
      throw new Error(this.worker !== worker ? 'Call media server unavailable' : 'This call already has a media room');
    }
    const room = new CallMediaRoom(callId, router, server, () => {
      // A dead worker closes its routers (and so its rooms) BEFORE it emits 'died': those rooms stay listed until
      // onWorkerDied has named them.
      if (!worker.died && this.rooms.get(callId) === room) this.rooms.delete(callId);
    });
    this.rooms.set(callId, room);
    return room;
  }

  /** The open room of `callId`, if any. */
  room(callId: string): CallMediaRoom | null {
    return this.rooms.get(callId) ?? null;
  }

  private async startWorker(): Promise<void> {
    const config = this.config!;
    const mediasoup = await import('mediasoup');
    const worker = await mediasoup.createWorker({ logLevel: 'warn' });
    if (this.stopped) {
      worker.close();
      return;
    }
    try {
      const listen = { ip: config.listenIp, announcedAddress: config.announcedAddress, port: config.port, exposeInternalIp: true };
      this.server = await worker.createWebRtcServer({ listenInfos: [{ protocol: 'udp', ...listen }, { protocol: 'tcp', ...listen }] });
    } catch (e) {
      worker.close();
      throw e;
    }
    worker.on('died', (error) => this.onWorkerDied(worker, error));
    this.worker = worker;
    this.logger.log(`Call media server up: worker pid ${worker.pid}, port ${config.port}`);
  }

  private onWorkerDied(worker: ms.Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.server = null;
    const callIds = [...this.rooms.keys()];
    for (const room of [...this.rooms.values()]) room.close();
    this.rooms.clear();
    this.logger.error(`Call media worker died (${clean(error?.message ?? error)}); ${callIds.length} call(s) lost their media; restarting`);
    const payload: CallsMediaWorkerDiedPayload = { calls: callIds.length };
    this.eventEmitter.emit(InternalEvents.CALLS_MEDIA_WORKER_DIED, payload);
    this.events.emit('worker-died', callIds);
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    const delay = Math.min(MAX_RESTART_DELAY_MS, 1000 * 2 ** this.failedRestarts);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startWorker().then(
        () => { this.failedRestarts = 0; },
        (e) => {
          this.failedRestarts++;
          this.logger.error(`Call media worker restart failed: ${clean((e as Error)?.message ?? e)}`);
          this.scheduleRestart();
        },
      );
    }, delay);
  }
}

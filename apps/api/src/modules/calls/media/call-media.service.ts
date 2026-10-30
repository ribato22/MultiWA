// MultiWA Gateway - the call media server (mediasoup SFU)
// apps/api/src/modules/calls/media/call-media.service.ts
//
// ONE mediasoup Worker and ONE WebRtcServer (a single UDP+TCP port for every media transport) per api process, and
// one CallMediaRoom per call that is being answered. Off unless CALLS_MEDIA_ENABLED=true: then mediasoup is never
// even loaded. A worker that dies closes every room it carried (those calls lost their media); the service tells its
// listeners (`events`: 'worker-died' with the call ids), counts it, and starts a new worker with backoff (one that
// died soon after it started counts as a failed restart). A bad setting fails the boot, but a worker that cannot start
// (the port is taken) does not: messaging goes on, the media server stays down and the start is retried the same way.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventEmitter } from 'node:events';
import type { types as ms } from 'mediasoup';
import { InternalEvents, type CallsMediaWorkerDiedPayload } from '../../../metrics/internal-events';
import { CallMediaRoom } from './call-media-room';
import { readCallMediaConfig, type CallMediaConfig, type CallMediaIceServer } from './media-config';

const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const MAX_RESTART_DELAY_MS = 30_000;
/** A worker that lived this long was healthy: when it dies, the restart backoff starts over. */
const HEALTHY_UPTIME_MS = 60_000;

/** The media server's state, for authenticated readers. The public /health shows only `publicStatus()`. */
export interface CallMediaStatus {
  enabled: boolean;
  worker: 'up' | 'down';
  port: number | null;
  activeRooms: number;
}

@Injectable()
export class CallMediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallMediaService.name);
  /** 'worker-died' (callIds: string[]): the rooms the dead worker closed. Each listener runs on its own: one that throws is logged and the others still run. */
  readonly events = new EventEmitter();
  private config: CallMediaConfig | null = null;
  private worker: ms.Worker | null = null;
  private server: ms.WebRtcServer | null = null;
  private readonly rooms = new Map<string, CallMediaRoom>();
  private failedRestarts = 0;
  private startedAt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async onModuleInit(): Promise<void> {
    this.config = readCallMediaConfig(); // throws on a bad setting: the boot fails with the variable's name
    // A worker that will not start (the port is taken, the binary will not run) must not keep the gateway from booting:
    // messaging goes on, the media server stays down, and the start is retried with backoff.
    if (this.config) await this.startWorker().catch((e) => this.startFailed(e));
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
    return { ...this.publicStatus(), port: this.config?.port ?? null, activeRooms: this.rooms.size };
  }

  /** What the public /health shows: whether the server is on and its worker is up, and nothing else. */
  publicStatus(): Pick<CallMediaStatus, 'enabled' | 'worker'> {
    return { enabled: !!this.config, worker: this.worker ? 'up' : 'down' };
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
    // mediasoup logs through the `debug` module, which prints nothing unless DEBUG names it: its warnings and errors, the
    // worker's own among them, would never reach the api's log.
    mediasoup.setLogEventListeners({
      onwarn: (ns, log) => this.logger.warn(`${clean(ns)} ${clean(log)}`),
      // a log that comes with an error ends with ':'
      onerror: (ns, log, error) => this.logger.error(`${clean(ns)} ${clean(log)}${error ? ` ${clean(error.message ?? error)}` : ''}`),
    });
    const worker = await mediasoup.createWorker({ logLevel: 'warn' });
    if (this.stopped) {
      worker.close();
      return;
    }
    let server: ms.WebRtcServer;
    try {
      const listen = { ip: config.listenIp, announcedAddress: config.announcedAddress, port: config.port, exposeInternalIp: true };
      server = await worker.createWebRtcServer({ listenInfos: [{ protocol: 'udp', ...listen }, { protocol: 'tcp', ...listen }] });
    } catch (e) {
      worker.close();
      throw e;
    }
    if (this.stopped) {
      worker.close(); // the api shut down meanwhile; closing the worker closes its WebRtcServer too
      return;
    }
    this.server = server;
    worker.on('died', (error) => this.onWorkerDied(worker, error));
    this.worker = worker;
    this.startedAt = Date.now();
    this.logger.log(`Call media server up: worker pid ${worker.pid}, port ${config.port}`);
  }

  private onWorkerDied(worker: ms.Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.server = null;
    // Upstream leak (mediasoup 3.32): Worker.close() removes the worker's process.once('SIGINT'/'SIGTERM') listeners, but
    // workerDied(), the path that brought us here, leaves them, and a later close() returns early. Two listeners stay on
    // `process` per dead worker, each keeping its dead Worker reachable, and nothing here can remove them. The restart
    // backoff (up to MAX_RESTART_DELAY_MS between starts) bounds the growth.

    // A worker that dies soon after it started counts as a failed restart: a crash loop backs off instead of restarting
    // every second for ever.
    this.failedRestarts = Date.now() - this.startedAt >= HEALTHY_UPTIME_MS ? 0 : this.failedRestarts + 1;
    this.scheduleRestart(); // first: nothing below may keep the media server down
    const callIds = [...this.rooms.keys()];
    for (const room of [...this.rooms.values()]) room.close();
    this.rooms.clear();
    this.logger.error(`Call media worker died (${clean(error?.message ?? error)}); ${callIds.length} call(s) lost their media; restarting`);
    const payload: CallsMediaWorkerDiedPayload = { calls: callIds.length };
    // The bus stays ONE emit. It is an EventEmitter2: its emit also runs the onAny listeners (the plugin loader's, the
    // webhook dispatcher's), which listeners(name) does not return, so isolating its listeners one by one would mean
    // copying its emit. A throw there costs only the listeners behind it, on this one event; the @OnEvent ones (the
    // metrics counter) are async and never throw into the emit.
    this.emitSafely('event bus', () => this.eventEmitter.emit(InternalEvents.CALLS_MEDIA_WORKER_DIED, payload));
    // `events` is ours (the coordinator listens here): each listener gets its own try, so none depends on the ones before
    // it not throwing. rawListeners, not listeners, so that a once() listener stays a once() listener.
    for (const listener of this.events.rawListeners('worker-died')) this.emitSafely('worker-died', () => listener.call(this.events, callIds));
  }

  /** Plugins can listen to every event: a listener that throws is logged, and goes no further. */
  private emitSafely(what: string, emit: () => unknown): void {
    try {
      emit();
    } catch (e) {
      this.logger.error(`Call media ${what} listener threw: ${clean((e as Error)?.message ?? e)}`);
    }
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    const delay = Math.min(MAX_RESTART_DELAY_MS, 1000 * 2 ** this.failedRestarts);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startWorker().catch((e) => this.startFailed(e));
    }, delay);
  }

  /** A start that failed counts as a failed restart: try again, later. */
  private startFailed(e: unknown): void {
    this.failedRestarts++;
    this.logger.error(`Call media worker start failed: ${clean((e as Error)?.message ?? e)}`);
    this.scheduleRestart();
  }
}

// The call media server with a REAL mediasoup worker, no browser: it starts only when switched on, gives each call
// one room, and the room lets each peer do only its own part. A closed room leaves nothing behind in the WebRtcServer.
// A dead worker closes its rooms and is replaced; a stopped service never starts another worker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { types as ms } from 'mediasoup';
import { CallMediaService } from './call-media.service';
import { InternalEvents } from '../../../metrics/internal-events';

const OPUS = (ssrc: number) => ({
  codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: `c${ssrc}`, reducedSize: true },
});
const until = async (ok: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await new Promise((r) => setTimeout(r, 50));
  return ok();
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('CallMediaService', () => {
  let service: CallMediaService;
  let bus: EventEmitter2;

  beforeEach(() => {
    Logger.overrideLogger(false); // the service logs through Nest's static Logger, which writes to stdout
    bus = new EventEmitter2();
    service = new CallMediaService(bus);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Logger.overrideLogger(new ConsoleLogger());
  });
  const switchOn = () => {
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'true');
    vi.stubEnv('CALLS_MEDIA_ANNOUNCED_ADDRESS', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_LISTEN_IP', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_PORT', String(42000 + Math.floor(Math.random() * 3000)));
  };
  /** The transports the WebRtcServer still holds (mediasoup's test accessor). */
  const inServer = () => (service['server'] as any).webRtcTransportsForTesting.size as number;

  it('stays off with the switch off: no worker, and no room can be opened', async () => {
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'false');
    await service.onModuleInit();
    expect(service.status()).toEqual({ enabled: false, worker: 'down', port: null, announcedAddressSet: false, activeRooms: 0 });
    await expect(service.createRoom('CALL1')).rejects.toThrow('Call media server unavailable');
  });

  it('fails the boot with the variable name when switched on without an announced address', async () => {
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'true');
    vi.stubEnv('CALLS_MEDIA_ANNOUNCED_ADDRESS', '');
    await expect(service.onModuleInit()).rejects.toThrow(/CALLS_MEDIA_ANNOUNCED_ADDRESS/);
  });

  it('switched on: one worker; one room per call, whose transports announce the configured address', async () => {
    switchOn();
    await service.onModuleInit();
    expect(service.status()).toMatchObject({ enabled: true, worker: 'up', announcedAddressSet: true, activeRooms: 0 });
    const room = await service.createRoom('CALL1');
    await expect(service.createRoom('CALL1')).rejects.toThrow('already has a media room');
    const t: any = await room.signalingFor('page').createTransport('send');
    expect(t.iceCandidates.map((c: any) => c.address)).toContain('127.0.0.1');
    expect(service.status().activeRooms).toBe(1);
    expect(service.room('CALL1')).toBe(room);
    room.close();
    expect(service.status().activeRooms).toBe(0);
    expect(service.room('CALL1')).toBeNull();
  });

  it('the room lets each peer do only its own part', async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL1');
    const page = room.signalingFor('page');
    const agent = room.signalingFor('agent');
    const caps = await page.rtpCapabilities();
    const pageSend: any = await page.createTransport('send');
    const pageRecv: any = await page.createTransport('recv');
    const agentSend: any = await agent.createTransport('send');
    const agentRecv: any = await agent.createTransport('recv');
    await expect(page.createTransport('send')).rejects.toThrow('already has a send transport');
    await expect(page.createTransport('sideways' as any)).rejects.toThrow('send or recv');
    // a peer cannot use the other peer's transport
    await expect(agent.produce(pageSend.id, 'audio', OPUS(1))).rejects.toThrow("Not this peer's transport");
    await expect(page.produce(pageSend.id, 'video', OPUS(1))).rejects.toThrow('Audio only');
    const caller = await page.produce(pageSend.id, 'audio', OPUS(1111));
    await expect(page.produce(pageSend.id, 'audio', OPUS(1112))).rejects.toThrow('caller is already produced');
    const agentP = await agent.produce(agentSend.id, 'audio', OPUS(2222));
    expect(room.producerId('caller')).toBe(caller.id);
    expect(room.producerId('agent')).toBe(agentP.id);
    // the page consumes only the agent, the agent only the caller, each on its own receive transport
    await expect(page.consume(pageRecv.id, caller.id, caps)).rejects.toThrow('Not allowed to consume');
    await expect(agent.consume(agentRecv.id, agentP.id, caps)).rejects.toThrow('Not allowed to consume');
    await expect(agent.consume(agentSend.id, caller.id, caps)).rejects.toThrow("Not this peer's transport");
    const c: any = await agent.consume(agentRecv.id, caller.id, caps);
    expect(c).toMatchObject({ producerId: caller.id, kind: 'audio' });
    await expect(page.resumeConsumer(c.id)).rejects.toThrow("Not this peer's consumer");
    await agent.resumeConsumer(c.id);
    await agent.closeConsumer(c.id);
    room.close();
    await expect(page.rtpCapabilities()).rejects.toThrow('Media room closed');
  });

  it('one live consumer per peer; a closed producer can be produced again; closePeer lets a peer rejoin', async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL1');
    const page = room.signalingFor('page');
    const agent = room.signalingFor('agent');
    const caps = await page.rtpCapabilities();
    const pageSend: any = await page.createTransport('send');
    const caller = await page.produce(pageSend.id, 'audio', OPUS(1111));
    let agentRecv: any = await agent.createTransport('recv');
    const c1: any = await agent.consume(agentRecv.id, caller.id, caps);
    await expect(agent.consume(agentRecv.id, caller.id, caps)).rejects.toThrow('The agent already consumes');
    await agent.closeConsumer(c1.id);
    const c2: any = await agent.consume(agentRecv.id, caller.id, caps);
    expect(c2.id).not.toBe(c1.id);
    // the agent's browser reconnected: it rejoins with new transports and produces again
    const agentSend: any = await agent.createTransport('send');
    const first = await agent.produce(agentSend.id, 'audio', OPUS(2222));
    room.closePeer('agent');
    expect(room.producerId('agent')).toBeNull();
    const agentSend2: any = await agent.createTransport('send');
    agentRecv = await agent.createTransport('recv');
    const second = await agent.produce(agentSend2.id, 'audio', OPUS(3333));
    expect(second.id).not.toBe(first.id);
    await expect(agent.consume(agentRecv.id, caller.id, caps)).resolves.toBeDefined();
    room.close();
  });

  it("closing a room releases its transports from the WebRtcServer, and only that room's", async () => {
    switchOn();
    await service.onModuleInit();
    const rooms = [await service.createRoom('CALL1'), await service.createRoom('CALL2')];
    for (const room of rooms) {
      for (const peer of ['page', 'agent'] as const) {
        await room.signalingFor(peer).createTransport('send');
        await room.signalingFor(peer).createTransport('recv');
      }
    }
    expect(inServer()).toBe(8);
    rooms[0].close();
    expect(inServer()).toBe(4);
    rooms[1].close();
    expect(inServer()).toBe(0);
  });

  it('a transport still being created when its room closes is not handed out, and does not stay in the WebRtcServer', async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL1');
    const router = room['router'];
    const createWebRtcTransport = router.createWebRtcTransport.bind(router);
    vi.spyOn(router, 'createWebRtcTransport').mockImplementationOnce((options) => {
      const created = createWebRtcTransport(options); // the worker has the request...
      room.close(); // ...when the room closes
      return created;
    });
    await expect(room.signalingFor('page').createTransport('send')).rejects.toThrow('Media room closed');
    expect(inServer()).toBe(0);
  });

  it("concurrent signalling cannot bypass a peer's limits; peers do not wait for each other; a closing room refuses what waits", async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL1');
    const page = room.signalingFor('page');
    const agent = room.signalingFor('agent');
    const caps = await page.rtpCapabilities();
    // The page's own scripts can call the bridge as fast as they like: calls made together must end up as calls made in turn.
    const settle = async (calls: Promise<any>[]) => {
      const done = await Promise.allSettled(calls);
      return {
        ok: done.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
        errors: done.flatMap((r) => (r.status === 'rejected' ? [r.reason.message as string] : [])),
      };
    };

    const sends = await settle(Array.from({ length: 5 }, () => page.createTransport('send')));
    const callers = await settle([1111, 1112].map((ssrc) => page.produce(sends.ok[0].id, 'audio', OPUS(ssrc))));
    const agentRecv: any = await agent.createTransport('recv');
    const consumers = await settle(Array.from({ length: 3 }, () => agent.consume(agentRecv.id, room.producerId('caller')!, caps)));
    const counts = { transports: sends.ok.length, producers: callers.ok.length, consumers: consumers.ok.length };
    expect(counts).toEqual({ transports: 1, producers: 1, consumers: 1 });
    expect(sends.errors).toEqual(Array(4).fill('The page already has a send transport'));
    expect(callers.errors).toEqual(['The caller is already produced']);
    expect(consumers.errors).toEqual(Array(2).fill('The agent already consumes'));
    expect(room.producerId('caller')).toBe(callers.ok[0].id); // no producer is left orphaned

    // An agent operation held at the worker does not hold up the page.
    const router = room['router'];
    const createWebRtcTransport = router.createWebRtcTransport.bind(router);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(router, 'createWebRtcTransport').mockImplementationOnce(async (options) => {
      await held;
      return createWebRtcTransport(options);
    });
    const slow = agent.createTransport('send');
    let pageDone = false;
    void page.createTransport('recv').then(() => (pageDone = true));
    expect(await until(() => pageDone, 2000)).toBe(true);
    release();
    await expect(slow).resolves.toHaveProperty('iceParameters');

    // A room that closes while operations wait refuses each of them when its turn comes.
    const queued = [
      page.rtpCapabilities(),
      page.createTransport('recv'),
      page.connectTransport('t', {}),
      page.produce('t', 'audio', OPUS(9)),
      page.consume('t', 'p', caps),
      page.resumeConsumer('c'),
      page.closeConsumer('c'),
    ];
    room.close();
    expect(await settle(queued)).toEqual({ ok: [], errors: Array(7).fill('Media room closed') });
  });

  it('a dead worker closes its rooms, tells its listeners, counts it, and is replaced', async () => {
    switchOn();
    await service.onModuleInit();
    await service.createRoom('CALL7');
    const died = new Promise<string[]>((resolve) => service.events.once('worker-died', resolve));
    const counted = vi.fn();
    bus.on(InternalEvents.CALLS_MEDIA_WORKER_DIED, counted);
    const pid = service.workerPid()!;
    process.kill(pid, 'SIGKILL');
    expect(await died).toEqual(['CALL7']);
    expect(counted).toHaveBeenCalledWith({ calls: 1 });
    expect(service.status()).toMatchObject({ worker: 'down', activeRooms: 0 });
    expect(await until(() => service.status().worker === 'up', 10_000)).toBe(true);
    expect(service.workerPid()).not.toBe(pid);
    await expect(service.createRoom('CALL8')).resolves.toBeDefined();
  }, 20_000);

  it('shuts down for good: a restart still waiting on its timer never happens', async () => {
    switchOn();
    await service.onModuleInit();
    const { observer } = await import('mediasoup');
    const spawned = vi.fn();
    observer.on('newworker', spawned);
    const died = new Promise((resolve) => service.events.once('worker-died', resolve));
    process.kill(service.workerPid()!, 'SIGKILL');
    await died; // the restart is on its timer now
    await service.onModuleDestroy();
    await new Promise((r) => setTimeout(r, 2500)); // longer than the backoff
    observer.off('newworker', spawned);
    expect(service.status().worker).toBe('down');
    expect(service.workerPid()).toBeNull();
    expect(spawned).not.toHaveBeenCalled();
  }, 15_000);

  it('a shutdown while the worker is still starting leaves no worker behind', async () => {
    switchOn();
    const { observer } = await import('mediasoup');
    let worker!: ms.Worker;
    let reached!: () => void;
    let release!: () => void;
    const inWindow = new Promise<void>((resolve) => (reached = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    observer.once('newworker', (w) => {
      worker = w;
      const createWebRtcServer = w.createWebRtcServer.bind(w);
      vi.spyOn(w, 'createWebRtcServer').mockImplementationOnce(async (options) => {
        reached();
        await held;
        return createWebRtcServer(options);
      });
    });
    const starting = service.onModuleInit();
    await inWindow; // the worker runs; its WebRtcServer is not made yet
    await service.onModuleDestroy(); // the api shuts down in that window
    release();
    await starting;
    expect(service.status().worker).toBe('down');
    expect(service.workerPid()).toBeNull();
    expect(await until(() => !alive(worker.pid), 5000)).toBe(true); // the worker process is gone
  }, 15_000);
});

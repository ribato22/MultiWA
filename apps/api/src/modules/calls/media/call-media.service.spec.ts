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
    vi.useRealTimers();
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
  /**
   * The next worker starts, but its WebRtcServer is not made until `release()`, and then it is (or fails with `failWith`).
   * `inWindow` settles when the start is waiting there; `worker` is that worker.
   */
  const holdNextWebRtcServer = async (failWith?: Error) => {
    const { observer } = await import('mediasoup');
    let reached!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const hold = { worker: undefined as ms.Worker | undefined, inWindow: new Promise<void>((resolve) => (reached = resolve)), release: () => release() };
    observer.once('newworker', (w) => {
      hold.worker = w;
      const createWebRtcServer = w.createWebRtcServer.bind(w);
      vi.spyOn(w, 'createWebRtcServer').mockImplementationOnce(async (options) => {
        reached();
        await held;
        if (failWith) throw failWith;
        return createWebRtcServer(options);
      });
    });
    return hold;
  };

  it('stays off with the switch off: no worker, and no room can be opened', async () => {
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'false');
    await service.onModuleInit();
    expect(service.status()).toEqual({ enabled: false, worker: 'down', port: null, activeRooms: 0 });
    expect(service.publicStatus()).toEqual({ enabled: false, worker: 'down' });
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
    expect(service.status()).toEqual({ enabled: true, worker: 'up', port: Number(process.env.CALLS_MEDIA_PORT), activeRooms: 0 });
    expect(service.publicStatus()).toEqual({ enabled: true, worker: 'up' }); // the public /health: no port, no call counts
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

  describe('closePeer voids what the peer had in flight', () => {
    /**
     * The next `obj[method]` call does its work at the worker, then waits for `release()` before it returns: the peer
     * closes while the worker already has the request. `made` is what it made, with `close` spied on.
     */
    const finishLate = (obj: any, method: string) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const real = obj[method].bind(obj);
      const made: any[] = [];
      vi.spyOn(obj, method).mockImplementationOnce(async (...args: unknown[]) => {
        const resource = await real(...args);
        vi.spyOn(resource, 'close');
        made.push(resource);
        await held;
        return resource;
      });
      return { made, release, started: () => vi.waitFor(() => expect(made).toHaveLength(1)) };
    };
    const outcome = (p: Promise<unknown>) => p.then(() => 'done', (e: Error) => e.message);

    it('a transport still being made, and an operation waiting behind it, leave no transport; the peer can rejoin', async () => {
      switchOn();
      await service.onModuleInit();
      const room = await service.createRoom('CALL1');
      const agent = room.signalingFor('agent');
      const late = finishLate(room['router'], 'createWebRtcTransport');
      const making = outcome(agent.createTransport('send'));
      await late.started();
      const waiting = outcome(agent.createTransport('recv')); // issued before the close, still waiting its turn
      room.closePeer('agent'); // the agent's browser reconnected
      late.release();
      expect([await making, await waiting]).toEqual(['The agent was closed', 'The agent was closed']);
      expect(late.made[0].close).toHaveBeenCalled(); // what the worker made is closed, not kept
      expect(inServer()).toBe(0);
      await expect(agent.createTransport('send')).resolves.toHaveProperty('iceParameters'); // not "already has a send transport"
      await expect(agent.createTransport('recv')).resolves.toHaveProperty('iceParameters');
      expect(inServer()).toBe(2);
      room.close();
    });

    it('a producer still being made leaves no producer; the peer can produce again', async () => {
      switchOn();
      await service.onModuleInit();
      const room = await service.createRoom('CALL1');
      const agent = room.signalingFor('agent');
      const send: any = await agent.createTransport('send');
      const late = finishLate(room['transports'].get(send.id)!.transport, 'produce');
      const producing = outcome(agent.produce(send.id, 'audio', OPUS(2222)));
      await late.started();
      room.closePeer('agent');
      late.release();
      expect(await producing).toBe('The agent was closed');
      expect(late.made[0].close).toHaveBeenCalled();
      expect(room.producerId('agent')).toBeNull();
      const send2: any = await agent.createTransport('send');
      await expect(agent.produce(send2.id, 'audio', OPUS(3333))).resolves.toHaveProperty('id'); // not "already produced"
      room.close();
    });

    it('a consumer still being made leaves no consumer; the peer can consume again', async () => {
      switchOn();
      await service.onModuleInit();
      const room = await service.createRoom('CALL1');
      const page = room.signalingFor('page');
      const agent = room.signalingFor('agent');
      const caps = await page.rtpCapabilities();
      const pageSend: any = await page.createTransport('send');
      const caller = await page.produce(pageSend.id, 'audio', OPUS(1111));
      const recv: any = await agent.createTransport('recv');
      const late = finishLate(room['transports'].get(recv.id)!.transport, 'consume');
      const consuming = outcome(agent.consume(recv.id, caller.id, caps));
      await late.started();
      room.closePeer('agent');
      late.release();
      expect(await consuming).toBe('The agent was closed');
      expect(late.made[0].close).toHaveBeenCalled();
      const recv2: any = await agent.createTransport('recv');
      await expect(agent.consume(recv2.id, caller.id, caps)).resolves.toMatchObject({ producerId: caller.id }); // not "already consumes"
      room.close();
    });
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

  it("mediasoup's own warnings and errors reach its log, without their line breaks", async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL1');
    const warned = vi.spyOn(service['logger'], 'warn');
    const logged = vi.spyOn(service['logger'], 'error');
    // a producer the router does not know: mediasoup logs an error, and says no
    expect(room['router'].canConsume({ producerId: 'no\nsuch', rtpCapabilities: room['router'].rtpCapabilities })).toBe(false);
    expect(logged).toHaveBeenCalledWith('mediasoup:ERROR:Router canConsume() | Producer with id "nosuch" not found');
    // a listener of a mediasoup event threw: an error that comes with the Error
    const router = room['router'] as any;
    router.once('probe', () => {
      throw new Error('bad\nlistener');
    });
    router.safeEmit('probe');
    expect(logged).toHaveBeenCalledWith('mediasoup:ERROR:Router event listener threw an error [eventName:probe]: badlistener');
    // a request the worker refuses (its port is taken, by this very server): a warning
    const listen = { protocol: 'udp' as const, ip: '127.0.0.1', port: service.status().port! };
    await expect(service['worker']!.createWebRtcServer({ listenInfos: [listen] })).rejects.toThrow(/address already in use/);
    expect(warned).toHaveBeenCalledWith(expect.stringMatching(/^mediasoup:WARN:Channel request failed .*address already in use/));
    expect([...warned.mock.calls, ...logged.mock.calls].some(([line]) => /[\r\n]/.test(String(line)))).toBe(false);
  });

  it('a listener that throws on a worker death cannot stop the replacement, and cannot forge a log line', async () => {
    switchOn();
    await service.onModuleInit();
    const logged = vi.spyOn(service['logger'], 'error');
    const throws = vi.fn(() => {
      throw new Error('boom\nERROR [Forged] a line that is not ours');
    });
    bus.on(InternalEvents.CALLS_MEDIA_WORKER_DIED, throws); // plugins can subscribe to every event
    service.events.on('worker-died', throws);
    const pid = service.workerPid()!;
    process.kill(pid, 'SIGKILL');
    expect(await until(() => service.status().worker === 'up' && service.workerPid() !== pid, 8000)).toBe(true);
    expect(throws).toHaveBeenCalledTimes(2); // each emit ran, whatever the other did
    const lines = logged.mock.calls.map(([message]) => String(message));
    expect(lines.filter((l) => l.includes('boom'))).toHaveLength(2);
    expect(lines.some((l) => /[\r\n]/.test(l))).toBe(false);
  }, 20_000);

  it("a 'worker-died' listener that throws does not keep the other listeners of the event from running", () => {
    vi.useFakeTimers();
    vi.spyOn(service as any, 'startWorker').mockResolvedValue(undefined);
    const logged = vi.spyOn(service['logger'], 'error');
    const throws = vi.fn(() => {
      throw new Error('boom');
    });
    const behindOnce = vi.fn();
    const behind = vi.fn();
    service.events.on('worker-died', throws);
    service.events.once('worker-died', behindOnce);
    service.events.on('worker-died', behind);
    const dies = () => {
      const worker = { died: true } as any;
      service['worker'] = worker;
      service['startedAt'] = Date.now();
      service['onWorkerDied'](worker, new Error('x'));
    };
    dies();
    dies();
    expect(throws).toHaveBeenCalledTimes(2);
    expect(behind).toHaveBeenCalledTimes(2);
    expect(behindOnce).toHaveBeenCalledTimes(1); // a once listener stays a once listener
    expect(logged.mock.calls.filter(([message]) => String(message).includes('boom'))).toHaveLength(2);
  });

  it('workers that die young are restarted with a growing delay; one that lived a minute starts the backoff over', () => {
    vi.useFakeTimers();
    vi.spyOn(service as any, 'startWorker').mockResolvedValue(undefined);
    const dies = (livedMs: number) => {
      const worker = { died: true } as any;
      service['worker'] = worker;
      service['startedAt'] = Date.now() - livedMs;
      service['onWorkerDied'](worker, new Error('boom'));
      const before = Date.now();
      vi.advanceTimersToNextTimer(); // the restart
      return Date.now() - before;
    };
    const delays = [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 59_999, 60_000, 1_000].map(dies);
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 1_000, 2_000]);
  });

  it('a media server that cannot start does not fail the boot: it stays down, logs why, and retries until it can', async () => {
    switchOn();
    const other = new CallMediaService(new EventEmitter2());
    try {
      await other.onModuleInit(); // holds the port
      const logged = vi.spyOn(service['logger'], 'error');
      await expect(service.onModuleInit()).resolves.toBeUndefined(); // the port is taken: the gateway still boots
      expect(service.status()).toMatchObject({ enabled: true, worker: 'down' });
      expect(service.workerPid()).toBeNull();
      // once, with the reason; mediasoup's own error line (the worker could not bind) comes before it
      const lines = logged.mock.calls.map(([message]) => String(message));
      expect(lines.filter((l) => /^Call media worker start failed: .*address already in use/.test(l))).toHaveLength(1);
      expect(lines.some((l) => /[\r\n]/.test(l))).toBe(false);
      await other.onModuleDestroy(); // the port is free again
      expect(await until(() => service.status().worker === 'up', 8000)).toBe(true);
    } finally {
      await other.onModuleDestroy();
    }
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
    await new Promise((r) => setTimeout(r, 3000)); // longer than the 2 s backoff and a worker's start
    observer.off('newworker', spawned);
    expect(service.status().worker).toBe('down');
    expect(service.workerPid()).toBeNull();
    expect(spawned).not.toHaveBeenCalled();
  }, 15_000);

  it('a shutdown while the worker is still starting leaves no worker behind', async () => {
    switchOn();
    const hold = await holdNextWebRtcServer();
    const starting = service.onModuleInit();
    await hold.inWindow; // the worker runs; its WebRtcServer is not made yet
    await service.onModuleDestroy(); // the api shuts down in that window
    hold.release();
    await starting;
    expect(service.status().worker).toBe('down');
    expect(service.workerPid()).toBeNull();
    expect(await until(() => !alive(hold.worker!.pid), 5000)).toBe(true); // the worker process is gone
  }, 15_000);

  it('a start that fails after the shutdown schedules no restart, and no worker is spawned later', async () => {
    switchOn();
    const { observer } = await import('mediasoup');
    const hold = await holdNextWebRtcServer(new Error('port taken'));
    const spawned = vi.fn();
    const starting = service.onModuleInit();
    await hold.inWindow;
    await service.onModuleDestroy(); // the api shuts down while the start waits...
    observer.on('newworker', spawned); // (the held worker is spawned already)
    try {
      hold.release(); // ...and the start then fails
      await starting;
      const restartScheduled = service['restartTimer'] !== null;
      await new Promise((r) => setTimeout(r, 2600)); // longer than the 2 s backoff of a first failed start, and a worker's start
      expect({ restartScheduled, spawned: spawned.mock.calls.length }).toEqual({ restartScheduled: false, spawned: 0 });
      expect(service.status().worker).toBe('down');
    } finally {
      observer.off('newworker', spawned);
    }
  }, 15_000);

  it("tells when a peer's link comes up and goes down: all its transports ICE-connected, none DTLS-failed", async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL-LINK');
    const told: Array<[string, boolean]> = [];
    room.onLinkChange((peer, up) => told.push([peer, up]));
    const agent = room.signalingFor('agent');
    const send: any = await agent.createTransport('send');
    const recv: any = await agent.createTransport('recv');
    // No browser here: drive the transports' state events the way the worker's notifications do.
    const transport = (id: string) => (room as any).transports.get(id).transport;
    expect(room.linkUp('agent')).toBe(false);
    transport(send.id).emit('icestatechange', 'connected');
    expect(room.linkUp('agent')).toBe(false); // the recv transport is not linked yet
    transport(recv.id).emit('icestatechange', 'completed');
    expect(room.linkUp('agent')).toBe(true);
    transport(recv.id).emit('icestatechange', 'disconnected');
    expect(room.linkUp('agent')).toBe(false);
    transport(recv.id).emit('icestatechange', 'connected');
    transport(send.id).emit('dtlsstatechange', 'failed');
    expect(room.linkUp('agent')).toBe(false);
    transport(send.id).emit('dtlsstatechange', 'connected');
    expect(room.linkUp('agent')).toBe(true);
    room.closePeer('agent'); // no transports: down
    expect(room.linkUp('agent')).toBe(false);
    expect(room.linkUp('page')).toBe(false);
    expect(told).toEqual([['agent', true], ['agent', false], ['agent', true], ['agent', false], ['agent', true], ['agent', false]]);
  });

  it('tells only what linkUp says: a transport that joins unlinked takes the link down; a closing peer is not up meanwhile', async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL-LINK3');
    const told: Array<[string, boolean]> = [];
    room.onLinkChange((peer, up) => told.push([peer, up]));
    const agent = room.signalingFor('agent');
    const transport = (id: string) => (room as any).transports.get(id).transport;
    const send: any = await agent.createTransport('send');
    transport(send.id).emit('icestatechange', 'connected');
    expect(told).toEqual([['agent', true]]); // its only transport is linked
    const recv: any = await agent.createTransport('recv');
    expect(told).toEqual([['agent', true], ['agent', false]]); // until one that is not joins it
    transport(recv.id).emit('icestatechange', 'connected');
    transport(send.id).emit('icestatechange', 'disconnected');
    expect(told).toEqual([['agent', true], ['agent', false], ['agent', true], ['agent', false]]);
    room.closePeer('agent'); // send closes first: recv, still linked, must not pass for the whole peer meanwhile
    expect(told).toEqual([['agent', true], ['agent', false], ['agent', true], ['agent', false]]);
  });

  /** A room whose agent is linked (both its transports ICE-connected), and a link listener added after that. */
  const roomWithLinkedAgent = async (callId: string) => {
    const room = await service.createRoom(callId);
    const agent = room.signalingFor('agent');
    for (const direction of ['send', 'recv'] as const) {
      const t: any = await agent.createTransport(direction);
      (room as any).transports.get(t.id).transport.emit('icestatechange', 'connected');
    }
    expect(room.linkUp('agent')).toBe(true);
    const told = vi.fn();
    room.onLinkChange(told);
    return { room, told };
  };

  it('a room being closed tells no link changes: its linked agent does not go down for the listeners', async () => {
    switchOn();
    await service.onModuleInit();
    const { room, told } = await roomWithLinkedAgent('CALL-LINK4');
    room.close();
    expect(told).not.toHaveBeenCalled();
  });

  it("nor does a room whose worker died: mediasoup closes the router's transports before the router's close reaches the room", async () => {
    switchOn();
    await service.onModuleInit();
    const { room, told } = await roomWithLinkedAgent('CALL-LINK5');
    const died = new Promise((resolve) => service.events.once('worker-died', resolve));
    process.kill(service.workerPid()!, 'SIGKILL');
    await died;
    expect(room.closed).toBe(true);
    expect(told).not.toHaveBeenCalled();
  }, 15_000);

  it('a link listener that throws stops neither the room nor the other listeners', async () => {
    switchOn();
    await service.onModuleInit();
    const room = await service.createRoom('CALL-LINK2');
    const seen = vi.fn();
    room.onLinkChange(() => {
      throw new Error('boom');
    });
    room.onLinkChange(seen);
    const t: any = await room.signalingFor('page').createTransport('send');
    (room as any).transports.get(t.id).transport.emit('icestatechange', 'connected');
    expect(seen).toHaveBeenCalledWith('page', true);
  });
});

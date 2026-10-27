// EngineManagerService and the calls runtime: callDeps binds the runtime to one profile (send-gated
// replies, the CALL notification type, the call:update realtime push); the engine's call callbacks reach
// the runtime in the order the engine reported them; the boot sweep closes calls the previous process left
// ringing. The runtime itself is pinned by calls-runtime.spec.ts: here it only receives what the manager hands over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() } } }));
vi.mock('../automation/rule-engine.service', () => ({ RuleEngineService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));
vi.mock('@multiwa/engine-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@multiwa/engine-runtime')>()),
  handleEngineCall: vi.fn(),
  handleCallLog: vi.fn(),
  closeStaleRingingCalls: vi.fn(),
}));

import { prisma } from '@multiwa/database';
import { EngineFactory } from '@multiwa/engines';
import type { EngineConfig } from '@multiwa/engines';
import { handleEngineCall, handleCallLog, closeStaleRingingCalls } from '@multiwa/engine-runtime';
import { EngineManagerService } from './engine-manager.service';
import { NotificationType } from '../notifications/notifications.service';

const P = '1eb28399-5fe1-40ed-bd0a-39a4b8ad4858';
const db = prisma as any;
const runtime = { handleEngineCall: handleEngineCall as any, handleCallLog: handleCallLog as any, closeStaleRingingCalls: closeStaleRingingCalls as any };

function make() {
  const realtime = { emitCallUpdate: vi.fn() };
  const messages = { sendText: vi.fn().mockResolvedValue({ id: 'm1' }) };
  const eventEmitter = { emit: vi.fn() };
  const svc = new EngineManagerService(realtime as any, {} as any, { createForOrg: vi.fn() } as any, eventEmitter as any, messages as any);
  const engine = { rejectCall: vi.fn().mockResolvedValue(undefined), resolveIdentity: vi.fn() };
  (svc as any).engines = new Map([[P, { engine, profileId: P, status: 'connected' }]]);
  const notify = vi.spyOn(svc as any, 'notifyOrgUsers').mockResolvedValue(undefined);
  const warn = vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  const log = vi.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  return { svc, realtime, messages, eventEmitter, engine, notify, warn, log };
}

// Connect the profile through a fake engine and return the EngineConfig the manager handed it:
// its callbacks are what the adapters call.
async function connect() {
  const ctx = make();
  const engine = { initialize: vi.fn().mockResolvedValue(undefined), connect: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() };
  (ctx.svc as any).engines = new Map();
  vi.spyOn(EngineFactory, 'create').mockReturnValue(engine as any);
  vi.spyOn(ctx.svc as any, 'cleanupStaleLockFiles').mockResolvedValue(undefined);
  vi.spyOn((ctx.svc as any).watchdog, 'start').mockImplementation(() => undefined);
  db.profile.findUnique.mockResolvedValueOnce({ id: P, engine: null, displayName: 'Line 1' });
  await ctx.svc.connectProfile(P);
  return { ...ctx, config: engine.initialize.mock.calls[0][0] as EngineConfig };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.profile.findUnique.mockReset().mockResolvedValue(null);
  db.profile.findMany.mockReset().mockResolvedValue([]);
  db.profile.update.mockReset().mockResolvedValue({});
  runtime.handleEngineCall.mockReset().mockResolvedValue(null);
  runtime.handleCallLog.mockReset().mockResolvedValue(null);
  runtime.closeStaleRingingCalls.mockReset().mockResolvedValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('EngineManagerService.callDeps', () => {
  it('sends replies through MessagesService (send gate) for the profile', async () => {
    const { svc, messages } = make();
    await (svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi');
    expect(messages.sendText).toHaveBeenCalledWith({ profileId: P, to: '628111000111@s.whatsapp.net', text: 'hi' });
  });

  it('notifies with the CALL type and pushes realtime for the profile', async () => {
    const { svc, realtime, notify } = make();
    const d = (svc as any).callDeps(P, null);
    await d.notify('t', 'b', { callId: 'c1' });
    expect(notify).toHaveBeenCalledWith(P, NotificationType.CALL, 't', 'b', { callId: 'c1' });
    d.emitRealtime({ callId: 'c1' });
    expect(realtime.emitCallUpdate).toHaveBeenCalledWith(P, { callId: 'c1' });
  });

  it('publishes on the app bus, which drives the webhooks', () => {
    const { svc, eventEmitter } = make();
    (svc as any).callDeps(P, null).emit('call.received', { callId: 'c1' });
    expect(eventEmitter.emit).toHaveBeenCalledWith('call.received', { callId: 'c1' });
  });

  it('rejects through the live engine of the profile', async () => {
    const { svc, engine } = make();
    await (svc as any).callDeps(P, null).rejectCall('wa-1');
    expect(engine.rejectCall).toHaveBeenCalledWith('wa-1');
  });

  it('cannot reject without a live engine: the runtime must not record a reject that never happened', async () => {
    const { svc } = make();
    (svc as any).engines.clear();
    await expect((svc as any).callDeps(P, null).rejectCall('wa-1')).rejects.toThrow(/no live engine/);
  });

  it('resolves identities through the engine of the profile', async () => {
    const { svc, engine } = make();
    engine.resolveIdentity.mockResolvedValue({ phoneJid: '628111000111@s.whatsapp.net' });
    await expect((svc as any).callDeps(P, null).resolveIdentity('1234567@lid')).resolves.toEqual({ phoneJid: '628111000111@s.whatsapp.net' });
    expect(engine.resolveIdentity).toHaveBeenCalledWith('1234567@lid');
  });
});

describe('the engine call callbacks', () => {
  const offer = (over: Record<string, unknown> = {}): any => ({ id: 'wa-1', from: '628111000111@c.us', isVideo: false, isGroup: false, ...over });
  const callLog: any = { messageId: 'log-1', callId: 'wa-1', from: '628111000111@c.us', isVideo: false, outcome: 'missed', timestamp: new Date() };

  // The runtime registers a call's ringing step when handleEngineCall is called and makes the later signals of
  // that call wait for it, so the manager must call it from the engine callback itself: an await before it
  // (the profile's settings are a database read) would let an `ended` or a call log overtake the offer.
  it('onCall hands the signal to the runtime synchronously, with the settings as a read still in progress', async () => {
    const { config } = await connect();
    const read = deferred<{ settings: unknown }>();
    db.profile.findUnique.mockReturnValueOnce(read.promise);

    expect(config.onCall!(offer())).toBeUndefined();
    expect(runtime.handleEngineCall).toHaveBeenCalledTimes(1); // nothing awaited since the engine called back; the read has not answered
    const [call, deps] = runtime.handleEngineCall.mock.calls[0];
    expect(call).toEqual(offer());
    expect(deps.profileId).toBe(P);
    expect(db.profile.findUnique).toHaveBeenLastCalledWith({ where: { id: P }, select: { settings: true } });

    read.resolve({ settings: { autoRejectCalls: true, autoRejectCallMessage: 'Maaf' } });
    await expect(deps.settings).resolves.toEqual({ autoRejectCalls: true, autoRejectCallMessage: 'Maaf' });
  });

  // No ringing-only guard: the runtime applies ended / accepted / rejected / missed itself.
  it.each([undefined, 'ringing', 'ended', 'accepted', 'rejected', 'missed'])('onCall passes the %s state on to the runtime', async (state) => {
    const { config } = await connect();
    config.onCall!(offer({ state }));
    expect(runtime.handleEngineCall).toHaveBeenCalledTimes(1);
    expect(runtime.handleEngineCall.mock.calls[0][0]).toEqual(offer({ state }));
  });

  it('a profile without stored settings resolves to nothing', async () => {
    const { config } = await connect();
    db.profile.findUnique.mockResolvedValueOnce({ settings: null });
    config.onCall!(offer());
    await expect(runtime.handleEngineCall.mock.calls[0][1].settings).resolves.toBeNull();
  });

  it('settings that cannot be read resolve to nothing, with a warning: the call is recorded all the same', async () => {
    const { config, warn } = await connect();
    db.profile.findUnique.mockRejectedValueOnce(new Error('db down'));
    config.onCall!(offer());
    await expect(runtime.handleEngineCall.mock.calls[0][1].settings).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('onCallLog hands the entry to the runtime synchronously, without settings', async () => {
    const { config } = await connect();
    expect(config.onCallLog!(callLog)).toBeUndefined();
    expect(runtime.handleCallLog).toHaveBeenCalledTimes(1);
    const [entry, deps] = runtime.handleCallLog.mock.calls[0];
    expect(entry).toBe(callLog);
    expect(deps).toMatchObject({ profileId: P, settings: null });
  });

  it('a runtime that fails is logged, and never throws or rejects into the adapter', async () => {
    const { config, warn } = await connect();
    runtime.handleEngineCall.mockRejectedValueOnce(new Error('boom'));
    runtime.handleCallLog.mockRejectedValueOnce(new Error('bang'));
    expect(() => config.onCall!(offer())).not.toThrow();
    expect(() => config.onCallLog!(callLog)).not.toThrow();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bang'));
    });
  });
});

describe('the boot sweep of calls left ringing', () => {
  async function boot() {
    const ctx = make();
    const reconnect = vi.spyOn(ctx.svc as any, 'autoReconnectProfiles').mockResolvedValue(undefined);
    try {
      await ctx.svc.onModuleInit();
    } finally {
      await ctx.svc.onModuleDestroy(); // clears the reconnect sweep timer
    }
    return { ...ctx, reconnect };
  }

  it('closes them, and says how many', async () => {
    runtime.closeStaleRingingCalls.mockResolvedValue(3);
    const { log } = await boot();
    expect(runtime.closeStaleRingingCalls).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringContaining('Closed 3 call(s)')));
  });

  it('does not hold the boot back: a sweep that never ends does not stop the reconnect', async () => {
    runtime.closeStaleRingingCalls.mockReturnValue(new Promise(() => undefined));
    const { reconnect } = await boot();
    expect(runtime.closeStaleRingingCalls).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('a sweep that fails is logged and fails nothing (e.g. a calls table that was never created)', async () => {
    runtime.closeStaleRingingCalls.mockRejectedValue(new Error('relation "calls" does not exist'));
    const { warn, reconnect } = await boot();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('relation "calls" does not exist')));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('is the worker\'s business when the worker hosts the engine', async () => {
    vi.stubEnv('ENGINE_HOST', 'worker');
    await boot();
    expect(runtime.closeStaleRingingCalls).not.toHaveBeenCalled();
  });
});

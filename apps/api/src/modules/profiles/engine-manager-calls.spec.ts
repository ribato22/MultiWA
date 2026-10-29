// EngineManagerService and the calls runtime: callDeps binds the runtime to one profile (send-gated
// replies, the CALL notification type, the call:update realtime push); the engine's call callbacks reach
// the runtime in the order the engine reported them; the boot sweep closes calls the previous process left
// ringing; rejectCallByAgent is what the REST reject calls (the worker's has the same job for engine-commands).
// The runtime itself is pinned by calls-runtime.spec.ts: here it only receives what the manager hands over.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() } } }));
vi.mock('../automation/rule-engine.service', () => ({ RuleEngineService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));
vi.mock('@multiwa/engine-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@multiwa/engine-runtime')>()),
  handleEngineCall: vi.fn(),
  handleCallLog: vi.fn(),
  closeStaleRingingCalls: vi.fn(),
  rejectCallByAgent: vi.fn(),
}));

import { prisma } from '@multiwa/database';
import { EngineFactory } from '@multiwa/engines';
import type { EngineConfig } from '@multiwa/engines';
import { handleEngineCall, handleCallLog, closeStaleRingingCalls, rejectCallByAgent, toCallPayload } from '@multiwa/engine-runtime';
import { EngineManagerService } from './engine-manager.service';
import { NotificationType } from '../notifications/notifications.service';

const P = '1eb28399-5fe1-40ed-bd0a-39a4b8ad4858';
const db = prisma as any;
// What MessagesService.sendText really resolves: it does not throw on an engine failure, only on what the send gate refuses.
const SENT = { success: true, messageId: 'm1', conversationId: 'conv-1', waMessageId: 'wa-m1', status: 'sent' };
const runtime = {
  handleEngineCall: handleEngineCall as any,
  handleCallLog: handleCallLog as any,
  closeStaleRingingCalls: closeStaleRingingCalls as any,
  rejectCallByAgent: rejectCallByAgent as any,
};

function make() {
  const realtime = { emitCallUpdate: vi.fn() };
  const messages = { sendText: vi.fn().mockResolvedValue(SENT) };
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
  runtime.rejectCallByAgent.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('EngineManagerService.callDeps', () => {
  it('sends replies through MessagesService (send gate) for the profile', async () => {
    const { svc, messages } = make();
    await (svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi');
    expect(messages.sendText).toHaveBeenCalledWith({ profileId: P, to: '628111000111@s.whatsapp.net', text: 'hi' });
  });

  it('hands the result of a reply the service accepted back to the runtime', async () => {
    const { svc } = make();
    await expect((svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi')).resolves.toEqual(SENT);
  });

  it('a reply that is only queued (durable send) is accepted: the queue consumer delivers it', async () => {
    const { svc, messages } = make();
    const queued = { success: true, messageId: 'm2', conversationId: 'conv-1', status: 'queued' };
    messages.sendText.mockResolvedValue(queued);
    await expect((svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi')).resolves.toEqual(queued);
  });

  // MessagesService.sendText RESOLVES when the engine fails ({ success: false, status: 'failed' }); it throws what the
  // send gate refuses and a profile with no engine (409 PROFILE_DISCONNECTED, #256). The runtime claims the
  // once-per-24h reply before sending and releases the claim only when sendText rejects, so a reply that was not sent
  // must reject here, or a failed auto-reply would block the next one for 24 h.
  it.each([
    [{ success: false, messageId: 'm1', conversationId: 'conv-1', status: 'failed', error: 'Evaluation failed: boom' }, /^reply not sent: Evaluation failed: boom$/],
    [{ success: false, status: 'failed' }, /^reply not sent: unknown reason$/],
  ])('a reply the service reports as not sent (%j) rejects, so the runtime releases its claim', async (result, reason) => {
    const { svc, messages } = make();
    messages.sendText.mockResolvedValue(result);
    await expect((svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi')).rejects.toThrow(reason);
  });

  it('lets a profile without an engine (409 PROFILE_DISCONNECTED) through unchanged', async () => {
    const { svc, messages } = make();
    const disconnected = new HttpException({ statusCode: 409, error: 'PROFILE_DISCONNECTED', message: 'Profile is not connected; the message was not sent' }, 409);
    messages.sendText.mockRejectedValue(disconnected);
    await expect((svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi')).rejects.toBe(disconnected);
  });

  it('lets what the send gate refuses through unchanged', async () => {
    const { svc, messages } = make();
    const refusal = new HttpException('Daily limit reached', 429);
    messages.sendText.mockRejectedValue(refusal);
    await expect((svc as any).callDeps(P, null).sendText('628111000111@s.whatsapp.net', 'hi')).rejects.toBe(refusal);
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

// The server switch for answering calls in the dashboard: only the exact string 'true' launches WhatsApp Web with
// the call-media hooks.
describe('the call media server switch', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['1', false],
    ['true', true],
  ])('CALLS_MEDIA_ENABLED=%s hands the engine callMedia.enabled=%s', async (value, enabled) => {
    vi.stubEnv('CALLS_MEDIA_ENABLED', value);
    const { config } = await connect();
    expect(config.callMedia).toEqual({ enabled });
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

describe('EngineManagerService.rejectCallByAgent (what the REST reject calls)', () => {
  const row: any = {
    id: 'c1', profileId: P, waCallId: 'wa-1', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
    direction: 'incoming', outcome: 'rejected', rejectedBy: 'agent', startedAt: new Date('2026-10-27T09:00:00Z'),
    endedAt: new Date('2026-10-27T09:00:05Z'), followUp: 'open', assignedUserId: null,
  };

  it('rejects through the live engine and answers with the call payload', async () => {
    const { svc, engine } = make();
    runtime.rejectCallByAgent.mockImplementation(async (_callId: string, deps: { rejectCall: (id: string) => Promise<void> }) => {
      await deps.rejectCall(row.waCallId);
      return row;
    });
    const payload = await svc.rejectCallByAgent(P, 'c1');
    expect(payload).toEqual(toCallPayload(row));
    expect(payload).toMatchObject({ callId: 'c1', outcome: 'rejected', rejectedBy: 'agent' });
    expect(runtime.rejectCallByAgent).toHaveBeenCalledWith('c1', expect.objectContaining({ profileId: P }));
    expect(engine.rejectCall).toHaveBeenCalledWith('wa-1');
  });

  // The call.rejected it records reaches webhooks and realtime through this manager's callDeps.
  it('hands the runtime this manager\'s own bus and realtime, so call.rejected is published like any engine event', async () => {
    const { svc, eventEmitter, realtime } = make();
    runtime.rejectCallByAgent.mockImplementation(async (_callId: string, deps: any) => {
      deps.emit('call.rejected', { callId: 'c1' });
      deps.emitRealtime({ callId: 'c1' });
      return row;
    });
    await svc.rejectCallByAgent(P, 'c1');
    expect(eventEmitter.emit).toHaveBeenCalledWith('call.rejected', { callId: 'c1' });
    expect(realtime.emitCallUpdate).toHaveBeenCalledWith(P, { callId: 'c1' });
  });

  it('is ENGINE_NOT_CONNECTED without a live engine, and the runtime is never asked', async () => {
    const { svc } = make();
    (svc as any).engines.clear();
    await expect(svc.rejectCallByAgent(P, 'c1')).rejects.toThrow(/^ENGINE_NOT_CONNECTED: profile .* is not connected$/);
    expect(runtime.rejectCallByAgent).not.toHaveBeenCalled();
  });

  // The REST layer maps these by their text (404 / 409): they must come out exactly as the runtime threw them.
  it.each(['CALL_NOT_FOUND', 'CALL_NOT_RINGING'])('%s from the runtime propagates unchanged', async (code) => {
    const { svc } = make();
    const err = new Error(`${code}: c1`);
    runtime.rejectCallByAgent.mockRejectedValue(err);
    await expect(svc.rejectCallByAgent(P, 'c1')).rejects.toBe(err);
  });

  // The runtime holds a call while its agent reject runs: whatever the engine reports about it meanwhile waits for
  // it. A stuck page (puppeteer's protocolTimeout is 240 s) must not hold the call for minutes after the REST call
  // has answered 504 at 30 s, so the manager bounds the engine's answer itself, below that.
  describe('an engine that does not answer the reject', () => {
    // The runtime calls deps.rejectCall and waits for it, as the real one does.
    const runtimeAwaitsTheEngine = () =>
      runtime.rejectCallByAgent.mockImplementation(async (_callId: string, deps: { rejectCall: (id: string) => Promise<void> }) => {
        await deps.rejectCall(row.waCallId);
        return row;
      });

    it('is given up after 25 s with ENGINE_TIMEOUT, so that the runtime lets go of the call', async () => {
      vi.useFakeTimers();
      const { svc, engine } = make();
      engine.rejectCall.mockReturnValue(new Promise(() => undefined));
      runtimeAwaitsTheEngine();
      let settled: unknown = 'pending';
      void svc.rejectCallByAgent(P, 'c1').then((v) => (settled = v), (e) => (settled = e));

      await vi.advanceTimersByTimeAsync(24_999);
      expect(settled).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBeInstanceOf(Error); // 'pending' would mean the manager is still waiting for the stuck engine
      expect((settled as Error).message).toBe('ENGINE_TIMEOUT: reject');
    });

    it('leaves no timer behind when the engine answers in time', async () => {
      vi.useFakeTimers();
      const { svc } = make();
      runtimeAwaitsTheEngine();
      await expect(svc.rejectCallByAgent(P, 'c1')).resolves.toMatchObject({ callId: 'c1' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the engine\'s own error when it fails in time', async () => {
      const { svc, engine } = make();
      engine.rejectCall.mockRejectedValue(new Error('Call is not ringing any more'));
      runtimeAwaitsTheEngine();
      await expect(svc.rejectCallByAgent(P, 'c1')).rejects.toThrow('Call is not ringing any more');
    });
  });
});

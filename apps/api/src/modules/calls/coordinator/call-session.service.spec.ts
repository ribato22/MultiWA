// The call coordinator with fakes all around it (the store, the media server and room, the page's bridge, the gateway,
// the bus): who is rung and when banners close; the claim and the connecting; every way a call ends.
// The real media path, sockets and two browsers are in call-session.integration.spec.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('@multiwa/database', () => ({ prisma: { user: { findUnique: vi.fn(), findMany: vi.fn() } } }));
vi.mock('./call-session-store', () => ({
  findCallForAnswer: vi.fn(),
  claimCall: vi.fn(),
  releaseClaim: vi.fn(),
  markAnswered: vi.fn(),
  markEnded: vi.fn(),
  reconcileAfterRestart: vi.fn(),
}));
vi.mock('../../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('./call-alerts', () => ({ CallAlerts: class {} }));

import { prisma } from '@multiwa/database';
import * as store from './call-session-store';
import { CallSessionService, readCallTimings } from './call-session.service';

const db = prisma as any;
const S = store as unknown as Record<string, ReturnType<typeof vi.fn>>;
const STARTED = new Date('2026-10-30T08:00:00Z');
const USERS: Record<string, any> = {
  u1: { id: 'u1', name: 'Ana', role: 'owner', isActive: true, organizationId: 'o1' },
  u2: { id: 'u2', name: 'Budi', role: 'member', isActive: true, organizationId: 'o1' },
  u3: { id: 'u3', name: 'Citra', role: 'viewer', isActive: true, organizationId: 'o1' },
  u4: { id: 'u4', name: 'Dewi', role: 'member', isActive: true, organizationId: 'o2' },
  u5: { id: 'u5', name: 'Eko', role: 'admin', isActive: false, organizationId: 'o1' },
};
const as = (userId: string, apiKeyScopes?: string[]) => ({ userId, organizationId: USERS[userId].organizationId, ...(apiKeyScopes !== undefined ? { apiKeyScopes } : {}) });
const ringing = (call: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) => ({
  call: { id: 'c1', profileId: 'p1', waCallId: 'W1', fromJid: '628111000111@c.us', isVideo: false, isGroup: false, outcome: 'ringing', answeredByUserId: null, startedAt: STARTED, ...call },
  profile: { id: 'p1', displayName: 'Line 1', settings: { callsAnswerInDashboard: true, ...settings }, organizationId: 'o1' },
  callerName: 'Pak Joko',
});
const flush = () => new Promise((r) => setImmediate(r));

const live: Array<{ service: CallSessionService }> = [];
function harness() {
  const online = new Set(['u1', 'u2', 'u3', 'u4', 'u5']);
  const gateway = { emitToUsers: vi.fn(), onlineUserIds: () => [...online], isUserOnline: (id: string) => online.has(id) };
  const bus = { emit: vi.fn() };
  const realtime = { emitCallUpdate: vi.fn() };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const alerts = { workerDied: vi.fn().mockResolvedValue(undefined) };
  const links: Array<(peer: string, up: boolean) => void> = [];
  const peer = () => ({
    rtpCapabilities: vi.fn(async () => ({ codecs: [] })),
    createTransport: vi.fn(async () => ({ id: 't1' })),
    connectTransport: vi.fn(async () => undefined),
    produce: vi.fn(async () => ({ id: 'agent-producer' })),
    consume: vi.fn(async () => ({ id: 'consumer-1' })),
    resumeConsumer: vi.fn(async () => undefined),
    closeConsumer: vi.fn(async () => undefined),
  });
  const agentPeer = peer();
  const room = {
    signalingFor: vi.fn((p: string) => (p === 'agent' ? agentPeer : peer())),
    close: vi.fn(),
    closePeer: vi.fn(),
    // The page's receive transport links at its first consume, which is the agent's connect.
    linkUp: vi.fn((peer: string) => peer !== 'page' || handle.connectAgent.mock.calls.length > 0),
    onLinkChange: vi.fn((l: any) => links.push(l)),
  };
  const callMedia = {
    createRoom: vi.fn(async () => room),
    publicStatus: vi.fn(() => ({ enabled: true, worker: 'up' })),
    iceServers: vi.fn(() => [{ urls: 'stun:stun.example.com:3478' }]),
    events: new EventEmitter(),
  };
  const handle = {
    callerProducerId: 'caller-producer',
    attachCaller: vi.fn(async () => ({ via: 'destination', freshCandidates: 1, fallback: false })),
    connectAgent: vi.fn(async (_agentProducerId: string) => undefined),
    disconnectAgent: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const media = {
    getSupport: vi.fn(async () => ({ supported: true, reasons: [] })),
    startCallMedia: vi.fn(async () => handle),
    answer: vi.fn(async () => ({ connectedAfterMs: 300 })),
    hangUp: vi.fn(async () => undefined),
    closeCallMedia: vi.fn(async () => undefined),
  };
  const engines = { getEngine: vi.fn(() => ({ callMedia: media })) };
  const service = new CallSessionService(callMedia as any, engines as any, gateway as any, bus as any, realtime as any, audit as any, alerts as any);
  /** What `event` sent, to whom. */
  const sent = (event: string) => gateway.emitToUsers.mock.calls.filter((c) => c[1] === event).map((c) => ({ to: c[0], payload: c[2] }));
  /** The call events published on the bus, in order; and the counters. */
  const published = () => bus.emit.mock.calls.map((c) => c[0]).filter((e: string) => e.startsWith('call.'));
  const counted = () => bus.emit.mock.calls.filter((c) => c[0] === 'internal.calls.session').map((c) => c[1]);
  const link = (peer: string, up: boolean) => {
    for (const l of links) l(peer, up);
  };
  const h = { service, gateway, bus, realtime, audit, alerts, room, agentPeer, links, callMedia, handle, media, engines, online, sent, published, counted, link };
  live.push(h);
  return h;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  db.user.findUnique.mockReset().mockImplementation(async ({ where }: any) => USERS[where.id] ?? null);
  db.user.findMany.mockReset().mockImplementation(async ({ where }: any) =>
    Object.values(USERS)
      .filter((u) => where.id.in.includes(u.id) && u.organizationId === where.organizationId && u.isActive === where.isActive && where.role.in.includes(u.role))
      .map((u) => ({ id: u.id })),
  );
  for (const fn of Object.values(S)) fn.mockReset();
  S.findCallForAnswer.mockResolvedValue(ringing());
  S.claimCall.mockResolvedValue(true);
  S.releaseClaim.mockResolvedValue(true);
  S.markAnswered.mockImplementation(async (id: string, userId: string, at: Date) => ({ ...ringing().call, id, outcome: 'answered', answeredByUserId: userId, answeredAt: at, followUp: 'done' }));
  S.markEnded.mockImplementation(async (id: string, endedBy: string, endReason: string, at: Date) => ({ ...ringing().call, id, outcome: 'answered', answeredAt: STARTED, endedAt: at, endedBy, endReason, talkSeconds: 42 }));
  S.reconcileAfterRestart.mockResolvedValue({ ended: [], released: 0 });
});
afterEach(() => {
  for (const h of live.splice(0)) for (const s of (h.service as any).sessions.values()) for (const t of Object.values(s.timers)) clearTimeout(t as any);
  vi.useRealTimers();
});

/** u1's browser, on c1: it produces its voice and resumes the caller. */
async function agentReady(h: ReturnType<typeof harness>) {
  await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
  await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
}

/** u1 answers c1, then plays the agent's browser: it produces its voice and resumes the caller. */
async function answered(h: ReturnType<typeof harness>) {
  expect(await h.service.answer(as('u1'), 'c1')).toMatchObject({ ok: true });
  await agentReady(h);
  await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(1));
}

/** markAnswered held until the returned function stores the answer. */
function holdAnswer() {
  let store!: () => void;
  S.markAnswered.mockImplementationOnce(
    (id: string, userId: string, at: Date) =>
      new Promise((r) => (store = () => r({ ...ringing().call, id, outcome: 'answered', answeredByUserId: userId, answeredAt: at, followUp: 'done' }))),
  );
  return () => store();
}

describe('CallSessionService: who is rung', () => {
  it('rings every online owner, admin and member of the organization (active), never a viewer or another organization', async () => {
    const h = harness();
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing')).toEqual([{
      to: ['u1', 'u2'],
      payload: {
        callId: 'c1', profileId: 'p1', profileName: 'Line 1', caller: { name: 'Pak Joko', number: '628111000111' },
        startedAt: STARTED.toISOString(), answerable: true,
      },
    }]);
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'rung' });
  });

  it('rings nobody for a profile without dashboard answering, one that rejects every call, or a call no longer ringing or already claimed', async () => {
    const h = harness();
    for (const f of [
      ringing({}, { callsAnswerInDashboard: false }),
      ringing({}, { autoRejectCalls: true }),
      ringing({ outcome: 'missed' }),
      ringing({ answeredByUserId: 'u2' }),
    ]) {
      S.findCallForAnswer.mockResolvedValueOnce(f);
      await h.service.onCallReceived({ callId: 'c1' });
    }
    h.online.clear(); // and nobody online
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing')).toEqual([]);
    expect((h.service as any).rung.size).toBe(0); // a ring that rang nobody keeps no entry
  });

  it('a call that stops ringing while its ring is prepared (the page probe) opens no banner, and leaves no entry', async () => {
    const h = harness();
    let probed!: () => void;
    h.media.getSupport.mockReturnValueOnce(new Promise((r) => (probed = () => r({ supported: true, reasons: [] }))));
    const rang = h.service.onCallReceived({ callId: 'c1' });
    await vi.waitFor(() => expect(h.media.getSupport).toHaveBeenCalled());
    h.service.onCallChanged({ callId: 'c1', outcome: 'missed' });
    probed();
    await rang;
    expect(h.sent('call:ringing')).toEqual([]);
    expect((h.service as any).rung.size).toBe(0);
  });

  it('a call that cannot be answered here still rings, saying why: a video or group call, or the first readiness reason', async () => {
    const h = harness();
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ isVideo: true }));
    await h.service.onCallReceived({ callId: 'c1' });
    h.callMedia.publicStatus.mockReturnValue({ enabled: true, worker: 'down' });
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing').map((s) => [s.payload.answerable, s.payload.unavailableReason])).toEqual([
      [false, 'video_call'],
      [false, 'media_server_down'],
    ]);
  });

  it('a LID caller has no number to show', async () => {
    const h = harness();
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ fromJid: '123456789012345@lid' }));
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing')[0].payload.caller).toEqual({ name: 'Pak Joko', number: null });
  });
});

describe('CallSessionService: availability', () => {
  it("an unavailable agent is not rung; their tabs are told; going offline makes them available again", async () => {
    const h = harness();
    expect(await h.service.setAvailability(as('u2'), false)).toEqual({ ok: true, available: false });
    expect(h.sent('call:availability')).toEqual([{ to: ['u2'], payload: { available: false } }]);
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing')[0].to).toEqual(['u1']);
    h.service.onUserOffline({ userId: 'u2' });
    await h.service.onCallReceived({ callId: 'c1' });
    expect(h.sent('call:ringing')[1].to).toEqual(['u1', 'u2']);
  });

  it('a viewer, an inactive user, any API-key socket (calls are answered in the dashboard) may not; a value that is not a boolean is refused', async () => {
    const h = harness();
    expect(await h.service.setAvailability(as('u3'), false)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.setAvailability(as('u5'), false)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.setAvailability(as('u1', []), false)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.setAvailability(as('u1', ['*']), false)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.setAvailability(as('u1'), true)).toEqual({ ok: true, available: true });
    expect(await h.service.setAvailability(as('u1'), 'no')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('CallSessionService: banners', () => {
  it('a call that stops ringing without a dashboard answer closes the banners it opened, once', async () => {
    const h = harness();
    await h.service.onCallReceived({ callId: 'c1' });
    h.service.onCallChanged({ callId: 'c1', outcome: 'ringing' });
    h.service.onCallChanged({ callId: 'c1', outcome: 'answered' });
    h.service.onCallChanged({ callId: 'c1', outcome: 'answered_elsewhere' });
    h.service.onCallChanged({ callId: 'c1', outcome: 'missed' });
    expect(h.sent('call:ended')).toEqual([{ to: ['u1', 'u2'], payload: { callId: 'c1', outcome: 'answered_elsewhere' } }]);
  });
});

describe('CallSessionService: boot and settings', () => {
  it('closes what the previous process left (answered calls, claims) once every module is initialized, not before', async () => {
    const h = harness();
    h.service.onModuleInit();
    await flush();
    expect(S.reconcileAfterRestart).not.toHaveBeenCalled();
    h.service.onApplicationBootstrap();
    await flush();
    expect(S.reconcileAfterRestart).toHaveBeenCalledTimes(1);
  });

  it('timings: 10 s to connect, 15 s of grace, a 120-minute cap; the env tunes them, and a bad value falls back', () => {
    expect(readCallTimings({})).toEqual({ connectMs: 10_000, agentGraceMs: 15_000, maxTalkMs: 120 * 60_000 });
    expect(readCallTimings({ CALLS_CONNECT_TIMEOUT_MS: '5000', CALLS_AGENT_GRACE_MS: 'x', CALLS_MAX_TALK_MINUTES: '30' })).toEqual({
      connectMs: 5_000, agentGraceMs: 15_000, maxTalkMs: 30 * 60_000,
    });
  });

  it("timings stop at setTimeout's longest delay (2^31 - 1 ms): a longer one would fire at once", () => {
    expect(readCallTimings({ CALLS_CONNECT_TIMEOUT_MS: '1e12', CALLS_AGENT_GRACE_MS: '3000000000', CALLS_MAX_TALK_MINUTES: '100000' })).toEqual({
      connectMs: 2 ** 31 - 1, agentGraceMs: 2 ** 31 - 1, maxTalkMs: 2 ** 31 - 1,
    });
  });
});

describe('CallSessionService: answering', () => {
  it('claims the call, opens its room and the page bridge, acks what the browser needs; the others are told who answered', async () => {
    const h = harness();
    await h.service.onCallReceived({ callId: 'c1' }); // rings u1 and u2
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({
      ok: true, callId: 'c1', callerProducerId: 'caller-producer', iceServers: [{ urls: 'stun:stun.example.com:3478' }],
    });
    expect(S.claimCall).toHaveBeenCalledWith('c1', 'u1');
    expect(h.callMedia.createRoom).toHaveBeenCalledWith('c1');
    expect(h.media.startCallMedia).toHaveBeenCalledWith('W1', expect.anything()); // the ENGINE's call id
    expect(h.sent('call:claimed')).toEqual([{ to: ['u2'], payload: { callId: 'c1', byUserId: 'u1', byUserName: 'Ana' } }]);
    expect(h.media.answer).not.toHaveBeenCalled(); // not before the agent's audio is ready
    expect(h.service.activeSessionCount()).toBe(1);
  });

  it('once the agent produced and listens: WhatsApp answers, the call is answered (published, audited, counted), caller and agent are put together', async () => {
    vi.useFakeTimers(); // the clock stands still: the whole connect budget is left for the answer
    const h = harness();
    await answered(h);
    expect(h.media.answer).toHaveBeenCalledWith('W1', { timeoutMs: 10_000 });
    expect(S.markAnswered).toHaveBeenCalledWith('c1', 'u1', expect.any(Date));
    expect(h.bus.emit).toHaveBeenCalledWith('call.answered', expect.objectContaining({ callId: 'c1', outcome: 'answered', answeredByUserId: 'u1' }));
    expect(h.realtime.emitCallUpdate).toHaveBeenCalledWith('p1', expect.objectContaining({ outcome: 'answered' }));
    expect(h.audit.log).toHaveBeenCalledWith({ action: 'call.answer', userId: 'u1', organizationId: 'o1', resourceType: 'call', resourceId: 'c1', metadata: { profileId: 'p1' } });
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'answered', answerSeconds: expect.any(Number) });
    expect(h.handle.attachCaller).toHaveBeenCalled();
    expect(h.handle.connectAgent).toHaveBeenCalledWith('agent-producer');
    expect(h.sent('call:active')).toEqual([{ to: ['u1'], payload: { callId: 'c1', answeredAt: expect.any(String) } }]);
  });

  it('refuses a viewer, another organization, a call no longer ringing or already claimed, a call that cannot be answered here, an agent on a call', async () => {
    const h = harness();
    expect(await h.service.answer(as('u3'), 'c1')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.answer(as('u4'), 'c1')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.answer(as('u1'), 42)).toEqual({ ok: false, reason: 'not_allowed' });
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ outcome: 'missed' }));
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'not_ringing' });
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ answeredByUserId: 'u2' }));
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'already_claimed' });
    for (const f of [ringing({ isVideo: true }), ringing({ isGroup: true }), ringing({}, { callsAnswerInDashboard: false })]) {
      S.findCallForAnswer.mockResolvedValueOnce(f);
      expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'media_unavailable' });
    }
    h.callMedia.publicStatus.mockReturnValueOnce({ enabled: true, worker: 'down' });
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'media_unavailable' });
    h.engines.getEngine.mockReturnValueOnce(null as any);
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'media_unavailable' });
    expect(S.claimCall).not.toHaveBeenCalled();
    await h.service.answer(as('u1'), 'c1'); // u1 is connecting this one now
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ id: 'c2', waCallId: 'W2' }));
    expect(await h.service.answer(as('u1'), 'c2')).toEqual({ ok: false, reason: 'busy' });
  });

  it('one agent answering two calls at once gets one of them: the other is busy', async () => {
    const h = harness();
    S.findCallForAnswer.mockImplementation(async (id: string) => ringing({ id, waCallId: `W-${id}` }));
    expect(await Promise.all([h.service.answer(as('u1'), 'c1'), h.service.answer(as('u1'), 'c2')])).toEqual([
      { ok: true, callId: 'c1', callerProducerId: 'caller-producer', iceServers: [{ urls: 'stun:stun.example.com:3478' }] },
      { ok: false, reason: 'busy' },
    ]);
    expect(S.claimCall.mock.calls).toEqual([['c1', 'u1']]);
    expect(h.service.activeSessionCount()).toBe(1);
  });

  it('WhatsApp gets what is left of the connect budget to answer, never less than a second', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    await vi.advanceTimersByTimeAsync(4_000); // the agent's browser took 4 s to produce and listen
    await agentReady(h);
    expect(h.media.answer.mock.calls).toEqual([['W1', { timeoutMs: 6_000 }]]);
    const late = harness();
    await late.service.answer(as('u1'), 'c1');
    await vi.advanceTimersByTimeAsync(9_500);
    await agentReady(late);
    expect(late.media.answer.mock.calls).toEqual([['W1', { timeoutMs: 1_000 }]]);
  });

  it('a lost claim says whether someone else has the call or it stopped ringing', async () => {
    const h = harness();
    S.claimCall.mockResolvedValue(false);
    S.findCallForAnswer.mockResolvedValueOnce(ringing()).mockResolvedValueOnce(ringing({ answeredByUserId: 'u2' }));
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'already_claimed' });
    S.findCallForAnswer.mockResolvedValueOnce(ringing()).mockResolvedValueOnce(ringing({ outcome: 'missed' }));
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'not_ringing' });
  });

  it('an agent on a call is not rung for another one', async () => {
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    S.findCallForAnswer.mockResolvedValueOnce(ringing({ id: 'c2', waCallId: 'W2' }));
    await h.service.onCallReceived({ callId: 'c2' });
    expect(h.sent('call:ringing').slice(-1)[0].to).toEqual(['u2']);
  });

  it('boot: the answered calls the previous process left get their call.ended (talk time unknown)', async () => {
    const h = harness();
    S.reconcileAfterRestart.mockResolvedValueOnce({
      ended: [{ ...ringing().call, outcome: 'answered', answeredByUserId: 'u1', answeredAt: STARTED, endedAt: STARTED, endedBy: 'server', endReason: 'server_restart', talkSeconds: null }],
      released: 0,
    });
    h.service.onApplicationBootstrap();
    await flush();
    expect(h.bus.emit).toHaveBeenCalledWith('call.ended', expect.objectContaining({ callId: 'c1', endReason: 'server_restart', talkSeconds: null }));
    expect(h.realtime.emitCallUpdate).toHaveBeenCalledWith('p1', expect.objectContaining({ endReason: 'server_restart' }));
  });
});

describe('CallSessionService: audio that does not connect', () => {
  it('not in time: the claim goes back, the agent is told, the call rings again (connect_timeout)', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    await vi.advanceTimersByTimeAsync(10_000); // the agent's browser never produced
    expect(h.media.answer).not.toHaveBeenCalled();
    expect(h.media.hangUp).not.toHaveBeenCalled(); // WhatsApp was never asked: nothing to hang up
    expect(h.media.closeCallMedia).toHaveBeenCalledWith('W1');
    expect(h.room.close).toHaveBeenCalled();
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    expect(h.sent('call:ended')).toContainEqual({ to: ['u1'], payload: { callId: 'c1', endReason: 'media_failed' } });
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'connect_timeout' });
    expect(h.sent('call:ringing').slice(-1)[0].to).toEqual(['u1', 'u2']); // rings again, this agent included
    expect(h.service.activeSessionCount()).toBe(0);
  });

  it('the page bridge does not start: the same, as page_start_failed', async () => {
    const h = harness();
    h.media.startCallMedia.mockRejectedValueOnce(new Error('Call is not the active call'));
    expect(await h.service.answer(as('u1'), 'c1')).toEqual({ ok: false, reason: 'media_failed' });
    expect(h.room.close).toHaveBeenCalled();
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'page_start_failed' });
  });

  it('WhatsApp does not answer: it is hung up all the same (its accept cannot be cancelled), released, and rung nowhere again', async () => {
    const h = harness();
    h.media.answer.mockRejectedValueOnce(new Error('Call did not connect in time'));
    await h.service.answer(as('u1'), 'c1');
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
    await vi.waitFor(() => expect(h.sent('call:ended')).toHaveLength(1));
    await flush();
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    expect(S.markAnswered).not.toHaveBeenCalled();
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'answer_failed' });
    expect(h.sent('call:ringing')).toEqual([]); // the call was hung up: it rings nowhere
  });

  it('the time runs out while WhatsApp answers: hung up at once, and again once the answer is over (an accept can connect late)', async () => {
    vi.useFakeTimers();
    const h = harness();
    let connected!: () => void;
    h.media.answer.mockReturnValueOnce(new Promise((r) => (connected = () => r({ connectedAfterMs: 9_000 }))));
    await h.service.answer(as('u1'), 'c1');
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.media.hangUp).toHaveBeenCalledTimes(1);
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    connected();
    await vi.waitFor(() => expect(h.media.hangUp).toHaveBeenCalledTimes(2));
    expect(S.markAnswered).not.toHaveBeenCalled();
  });

  it('the call stopped ringing while WhatsApp answered it: hung up and released, never answered', async () => {
    const h = harness();
    S.markAnswered.mockResolvedValueOnce(null);
    S.markEnded.mockResolvedValueOnce(null); // never answered, so never ended either
    await h.service.answer(as('u1'), 'c1');
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
    await vi.waitFor(() => expect(S.releaseClaim).toHaveBeenCalled());
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(h.bus.emit).not.toHaveBeenCalledWith('call.answered', expect.anything());
  });

  it("answered, but the caller's audio does not attach: the call is ended (media_failed, attach_failed), hung up, stored", async () => {
    const h = harness();
    h.handle.attachCaller.mockRejectedValueOnce(new Error('No caller audio'));
    await h.service.answer(as('u1'), 'c1');
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
    await vi.waitFor(() => expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'media_failed', expect.any(Date)));
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(h.bus.emit).toHaveBeenCalledWith('call.ended', expect.objectContaining({ endReason: 'media_failed' }));
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'attach_failed' });
    expect(h.sent('call:active')).toEqual([]);
  });

  it("a guess at the caller's audio is logged with the page's numbers cleaned of line breaks", async () => {
    const h = harness();
    const warn = vi.spyOn((h.service as any).logger, 'warn');
    h.handle.attachCaller.mockResolvedValueOnce({ via: 'element', freshCandidates: '3\r\nFORGED' as any, fallback: '\ntrue' as any });
    await answered(h);
    expect(warn).toHaveBeenCalledWith("Call c1: the caller's audio is a guess (3FORGED fresh candidate(s), fallback true)");
  });
});

describe('CallSessionService: once WhatsApp answered, every stop is one end', () => {
  it('the caller hangs up while the answer is stored: one end (caller_hangup), published after the answer, nothing attached', async () => {
    const h = harness();
    const store = holdAnswer();
    // The page's bridge refuses everything once it is closed.
    h.handle.attachCaller.mockImplementation(async () => {
      if (h.media.closeCallMedia.mock.calls.length) throw new Error('Media bridge closed');
      return { via: 'destination', freshCandidates: 1, fallback: false };
    });
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(S.markAnswered).toHaveBeenCalled());
    const hungUp = h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ended' });
    await flush();
    store();
    await hungUp;
    await flush();
    expect(h.sent('call:ended')).toEqual([{ to: ['u1'], payload: { callId: 'c1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 42 } }]);
    expect(h.published()).toEqual(['call.answered', 'call.ended']);
    expect(h.counted()).toEqual([{ kind: 'answered', answerSeconds: expect.any(Number) }, { kind: 'ended', endReason: 'caller_hangup' }]);
    expect(h.handle.attachCaller).not.toHaveBeenCalled();
    expect(h.media.hangUp).not.toHaveBeenCalled(); // the caller's own end
    expect(S.releaseClaim).not.toHaveBeenCalled();
    expect(h.sent('call:active')).toEqual([]);
    expect(h.service.activeSessionCount()).toBe(0);
  });

  it('the answer cannot be stored: the call is ended (media_failed, answer_failed), hung up, its claim given back, rung nowhere', async () => {
    const h = harness();
    const warn = vi.spyOn((h.service as any).logger, 'warn');
    S.markAnswered.mockRejectedValueOnce(new Error('Connection\r\nterminated'));
    S.markEnded.mockResolvedValueOnce(null); // never answered, so never ended either
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.sent('call:ended')).toHaveLength(1));
    await flush();
    expect(h.sent('call:ended')).toEqual([{ to: ['u1'], payload: { callId: 'c1', endedBy: 'server', endReason: 'media_failed', talkSeconds: null } }]);
    expect(h.media.hangUp.mock.calls).toEqual([['W1']]);
    expect(S.releaseClaim.mock.calls).toEqual([['c1', 'u1']]);
    expect(h.published()).toEqual([]);
    expect(h.counted()).toEqual([{ kind: 'media_failed', reason: 'answer_failed' }]); // ended counts answered calls only
    expect(warn).toHaveBeenCalledWith('Call c1: its answer was not stored: Connectionterminated');
    expect(h.sent('call:ringing')).toEqual([]);
    expect(h.service.activeSessionCount()).toBe(0);
  });

  it('the answer is written but not read back: the end still publishes call.answered before call.ended, and the ring is forgotten', async () => {
    const h = harness();
    await h.service.onCallReceived({ callId: 'c1' }); // rings u1 and u2
    S.markAnswered.mockRejectedValueOnce(new Error('Connection terminated')); // after its write: the row is answered
    S.markEnded.mockImplementationOnce(async (id: string, endedBy: string, endReason: string, at: Date) => ({
      ...ringing().call, id, outcome: 'answered', answeredByUserId: 'u1', answeredAt: STARTED, endedAt: at, endedBy, endReason, talkSeconds: 0,
    }));
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.sent('call:ended')).toHaveLength(1));
    await flush();
    expect(h.published()).toEqual(['call.answered', 'call.ended']);
    expect(h.bus.emit).toHaveBeenCalledWith('call.answered', expect.objectContaining({ callId: 'c1', outcome: 'answered', answeredByUserId: 'u1' }));
    expect(S.releaseClaim).not.toHaveBeenCalled(); // the claim is the answer now
    expect(h.counted()).toEqual([{ kind: 'rung' }, { kind: 'media_failed', reason: 'answer_failed' }]);
    expect((h.service as any).rung.has('c1')).toBe(false);
    expect(h.service.activeSessionCount()).toBe(0);
  });
});

describe("CallSessionService: the agent's media and Hang up", () => {
  it("signalling reaches the session's own agent only; room errors come back as media_error", async () => {
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    expect(await h.service.media(as('u1'), 'c1', 'rtpCapabilities', {})).toEqual({ ok: true, result: { codecs: [] } });
    expect(await h.service.media(as('u2'), 'c1', 'rtpCapabilities', {})).toEqual({ ok: false, reason: 'not_in_call' });
    expect(await h.service.media(as('u3'), 'c1', 'rtpCapabilities', {})).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.media(as('u1'), 'nope', 'rtpCapabilities', {})).toEqual({ ok: false, reason: 'not_in_call' });
    h.agentPeer.consume.mockRejectedValueOnce(new Error('Not allowed to consume\nthis producer'));
    expect(await h.service.media(as('u1'), 'c1', 'consume', {})).toEqual({ ok: false, reason: 'media_error', message: 'Not allowed to consumethis producer' });
    expect(await h.service.media(as('u1'), 'c1', 'teleport', {})).toEqual({ ok: false, reason: 'media_error', message: 'Unknown media signalling operation' });
  });

  it('Hang up in a call: WhatsApp hangs up, the media closes, the end is stored and published, the agent is told', async () => {
    const h = harness();
    await answered(h);
    expect(await h.service.hangup(as('u1'), 'c1')).toEqual({ ok: true });
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(h.media.closeCallMedia).toHaveBeenCalledWith('W1');
    expect(h.room.close).toHaveBeenCalled();
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'agent', 'hangup', expect.any(Date));
    expect(h.bus.emit).toHaveBeenCalledWith('call.ended', expect.objectContaining({ callId: 'c1', endedBy: 'agent', endReason: 'hangup', talkSeconds: 42 }));
    expect(h.sent('call:ended')).toContainEqual({ to: ['u1'], payload: { callId: 'c1', endedBy: 'agent', endReason: 'hangup', talkSeconds: 42 } });
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'ended', endReason: 'hangup' });
    expect(h.service.activeSessionCount()).toBe(0);
    expect(await h.service.hangup(as('u1'), 'c1')).toEqual({ ok: false, reason: 'not_in_call' });
  });

  it('Hang up while connecting gives the call up: released, and it rings again for everyone', async () => {
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    expect(await h.service.hangup(as('u1'), 'c1')).toEqual({ ok: true });
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    expect(h.sent('call:ended')).toContainEqual({ to: ['u1'], payload: { callId: 'c1', endReason: 'cancelled' } });
    expect(h.bus.emit).not.toHaveBeenCalledWith('internal.calls.session', expect.objectContaining({ kind: 'media_failed' }));
    expect(h.sent('call:ringing').slice(-1)[0].to).toEqual(['u1', 'u2']);
  });

  it('an agent demoted since the answer can still hang up their own call; nobody else, nor their API key', async () => {
    const h = harness();
    await answered(h);
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where.id === 'u1' ? { ...USERS.u1, role: 'viewer' } : (USERS[where.id] ?? null)));
    expect(await h.service.media(as('u1'), 'c1', 'rtpCapabilities', {})).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.hangup(as('u1', ['*']), 'c1')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await h.service.hangup(as('u2'), 'c1')).toEqual({ ok: false, reason: 'not_in_call' });
    expect(await h.service.hangup(as('u3'), 'c1')).toEqual({ ok: false, reason: 'not_allowed' });
    expect(S.markEnded).not.toHaveBeenCalled();
    expect(await h.service.hangup(as('u1'), 'c1')).toEqual({ ok: true });
    expect(S.markEnded.mock.calls).toEqual([['c1', 'agent', 'hangup', expect.any(Date)]]);
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
  });

  it('the end is stored as of the moment it happened, not once the hang-up and the teardown are over', async () => {
    vi.useFakeTimers();
    const h = harness();
    await answered(h);
    h.media.hangUp.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(undefined), 5_000)));
    const at = Date.now();
    const hungUp = h.service.hangup(as('u1'), 'c1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await hungUp).toEqual({ ok: true });
    expect(S.markEnded.mock.calls).toEqual([['c1', 'agent', 'hangup', new Date(at)]]);
  });

  it('the talk-time cap ends the call (server, time_limit)', async () => {
    vi.useFakeTimers();
    vi.stubEnv('CALLS_MAX_TALK_MINUTES', '1');
    const h = harness();
    await answered(h);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'time_limit', expect.any(Date));
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
  });
});

describe('CallSessionService: the caller, the engine and the media server end calls too', () => {
  it('the caller hangs up: the call ends as caller_hangup, and nothing hangs it up again', async () => {
    const h = harness();
    await answered(h);
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ringing' });
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'OTHER', state: 'ended' });
    expect(S.markEnded).not.toHaveBeenCalled();
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ended' });
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'caller', 'caller_hangup', expect.any(Date));
    expect(h.media.hangUp).not.toHaveBeenCalled();
    expect(h.media.closeCallMedia).toHaveBeenCalledWith('W1');
  });

  it('the caller gives up while the audio connects: undone and released, and it does not ring again', async () => {
    const h = harness();
    await h.service.answer(as('u1'), 'c1');
    const rings = h.sent('call:ringing').length;
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ended' });
    expect(S.releaseClaim).toHaveBeenCalledWith('c1', 'u1');
    expect(h.sent('call:ringing')).toHaveLength(rings);
    expect(h.service.activeSessionCount()).toBe(0);
  });

  it("neither the caller's own end nor a shutdown hangs up while WhatsApp answers; once the answer is over, it is hung up", async () => {
    const h = harness();
    let connected!: () => void;
    h.media.answer.mockReturnValueOnce(new Promise((r) => (connected = () => r({ connectedAfterMs: 900 }))));
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ended' });
    expect(S.releaseClaim.mock.calls).toEqual([['c1', 'u1']]);
    expect(h.media.hangUp).not.toHaveBeenCalled();
    connected(); // an accept already under way can still connect
    await vi.waitFor(() => expect(h.media.hangUp.mock.calls).toEqual([['W1']]));

    const down = harness();
    down.media.answer.mockReturnValueOnce(new Promise(() => undefined));
    await down.service.answer(as('u1'), 'c1');
    await agentReady(down);
    await down.service.onModuleDestroy();
    expect(S.releaseClaim.mock.calls).toEqual([['c1', 'u1'], ['c1', 'u1']]);
    expect(down.media.hangUp).not.toHaveBeenCalled();
  });

  it("the media server's worker dies: a call is ended (media_failed, worker_died), one still connecting rings again, the admins are told of the cut call", async () => {
    const h = harness();
    h.service.onModuleInit();
    await answered(h);
    S.findCallForAnswer.mockResolvedValue(ringing({ id: 'c2', waCallId: 'W2' }));
    expect(await h.service.answer(as('u2'), 'c2')).toMatchObject({ ok: true });
    h.callMedia.events.emit('worker-died', ['c1', 'c2']);
    await vi.waitFor(() => expect(h.alerts.workerDied).toHaveBeenCalledWith(['p1'], expect.any(Date)));
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'media_failed', expect.any(Date));
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'worker_died' });
    expect(S.releaseClaim).toHaveBeenCalledWith('c2', 'u2');
    expect(h.service.activeSessionCount()).toBe(0);
  });

  it("the profile's WhatsApp disconnects: its call ends (media_failed, engine_lost); other profiles' calls go on", async () => {
    const h = harness();
    await answered(h);
    await h.service.onProfileDisconnected({ profileId: 'p2' });
    expect(h.service.activeSessionCount()).toBe(1);
    await h.service.onProfileDisconnected({ profileId: 'p1' });
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'media_failed', expect.any(Date));
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'engine_lost' });
  });

  it('shutdown: an answered call is stored as ended (server_restart) without a hang-up; a claim is given back', async () => {
    const h = harness();
    await answered(h);
    S.findCallForAnswer.mockResolvedValue(ringing({ id: 'c2', waCallId: 'W2' }));
    await h.service.answer(as('u2'), 'c2');
    await h.service.onModuleDestroy();
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'server_restart', expect.any(Date));
    expect(h.media.hangUp).not.toHaveBeenCalled();
    expect(S.releaseClaim).toHaveBeenCalledWith('c2', 'u2');
  });
});

describe('CallSessionService: an agent lost, and back', () => {
  it('no socket for the whole grace: hung up as agent_lost; a socket back within it cancels', async () => {
    vi.useFakeTimers();
    const h = harness();
    await answered(h);
    h.online.delete('u1');
    h.service.onUserOffline({ userId: 'u1' });
    await vi.advanceTimersByTimeAsync(14_000);
    h.online.add('u1');
    h.service.onUserOnline({ userId: 'u1' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(S.markEnded).not.toHaveBeenCalled();
    h.online.delete('u1');
    h.service.onUserOffline({ userId: 'u1' });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'agent_lost', expect.any(Date));
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(vi.getTimerCount()).toBe(0); // the talk-time cap went with the call
  });

  it("the agent's media link down for the grace ends the call; back within it cancels; while either is lost the grace runs on", async () => {
    vi.useFakeTimers();
    const h = harness();
    await answered(h);
    const link = (up: boolean) => {
      for (const l of h.links) l('agent', up);
    };
    link(false);
    await vi.advanceTimersByTimeAsync(10_000);
    link(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(S.markEnded).not.toHaveBeenCalled();
    link(false);
    h.online.delete('u1');
    h.service.onUserOffline({ userId: 'u1' });
    link(true); // the sockets are still gone
    await vi.advanceTimersByTimeAsync(15_000);
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'agent_lost', expect.any(Date));
  });

  it("the page's media link down for the grace ends the call (media_failed, engine_lost); back within it cancels; the agent's grace is another", async () => {
    vi.useFakeTimers();
    const h = harness();
    await answered(h);
    h.link('page', false); // the page let its bridge go: the call is over, though the engine never said so
    await vi.advanceTimersByTimeAsync(10_000);
    h.link('page', true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(S.markEnded).not.toHaveBeenCalled();
    h.link('page', false);
    h.link('agent', false);
    h.link('agent', true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(S.markEnded.mock.calls).toEqual([['c1', 'server', 'media_failed', expect.any(Date)]]);
    expect(h.sent('call:ended')).toEqual([{ to: ['u1'], payload: { callId: 'c1', endedBy: 'server', endReason: 'media_failed', talkSeconds: 42 } }]);
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'engine_lost' });
    expect(h.media.closeCallMedia).toHaveBeenCalledWith('W1'); // the profile's bridge is free again
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a page whose media link is down from the answer on, and stays down, ends its call after the grace too', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.room.linkUp.mockImplementation((peer: string) => peer !== 'page');
    await answered(h);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(S.markEnded.mock.calls).toEqual([['c1', 'server', 'media_failed', expect.any(Date)]]);
  });

  it("the page's media link is watched from the agent's connect on: a link down at the answer, the connect slower than the grace, the call goes on", async () => {
    vi.useFakeTimers();
    vi.stubEnv('CALLS_AGENT_GRACE_MS', '3000');
    const h = harness();
    let connected!: () => void;
    h.handle.connectAgent.mockReturnValueOnce(new Promise((r) => (connected = () => r(undefined))));
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.handle.connectAgent).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(4_000); // past the grace, within the agent's own connect bound
    expect(S.markEnded).not.toHaveBeenCalled();
    connected();
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(S.markEnded).not.toHaveBeenCalled();
  });

  it('the agent rejoins while the caller is being attached: the new producer is connected, never the old one, and the call goes on', async () => {
    const h = harness();
    let attached!: () => void;
    h.handle.attachCaller.mockReturnValueOnce(new Promise((r) => (attached = () => r({ via: 'destination', freshCandidates: 1, fallback: false }))));
    // The room closed the old producer with the agent's transports: the page can no longer consume it.
    h.handle.connectAgent.mockImplementation(async (id: string) => {
      if (id === 'agent-producer' && h.room.closePeer.mock.calls.length) throw new Error('Producer closed');
      return undefined;
    });
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.handle.attachCaller).toHaveBeenCalled());
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    attached();
    await flush();
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't2', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-2' });
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(1));
    await flush();
    expect(h.handle.connectAgent.mock.calls).toEqual([['agent-producer-2']]);
    expect(h.sent('call:active')).toEqual([{ to: ['u1'], payload: { callId: 'c1', answeredAt: expect.any(String) } }]);
    expect(S.markEnded).not.toHaveBeenCalled();
    expect(h.service.activeSessionCount()).toBe(1);
  });

  it("a rejoin before the first connect still watches the page's link once the new agent is connected", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.room.linkUp.mockImplementation((peer: string) => peer !== 'page'); // the page's link never comes up
    let attached!: () => void;
    h.handle.attachCaller.mockReturnValueOnce(new Promise((r) => (attached = () => r({ via: 'destination', freshCandidates: 1, fallback: false }))));
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.handle.attachCaller).toHaveBeenCalled());
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    attached();
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't2', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-2' });
    await vi.waitFor(() => expect(h.handle.connectAgent).toHaveBeenCalledWith('agent-producer-2'));
    expect(S.markEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'media_failed', expect.any(Date));
  });

  it('the agent rejoins while it is being connected: no call:active for the old producer, one for the new', async () => {
    const h = harness();
    let connected!: () => void;
    h.handle.connectAgent.mockReturnValueOnce(new Promise((r) => (connected = () => r(undefined))));
    await h.service.answer(as('u1'), 'c1');
    await agentReady(h);
    await vi.waitFor(() => expect(h.handle.connectAgent).toHaveBeenCalledWith('agent-producer'));
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    connected(); // the old producer's connect ends after the rejoin took it off
    await flush();
    expect(h.sent('call:active')).toEqual([]);
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't2', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-2' });
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(1));
    await flush();
    expect(h.handle.connectAgent.mock.calls).toEqual([['agent-producer'], ['agent-producer-2']]);
    expect(h.sent('call:active')).toEqual([{ to: ['u1'], payload: { callId: 'c1', answeredAt: expect.any(String) } }]);
    expect(S.markEnded).not.toHaveBeenCalled();
  });

  it('two rejoins in quick succession: one call:active, for the last page only, and the call goes on', async () => {
    const h = harness();
    await answered(h);
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    let connected!: () => void;
    h.handle.connectAgent.mockReturnValueOnce(new Promise((r) => (connected = () => r(undefined))));
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await agentReady(h); // the reloaded page produces and listens: it is being connected
    await vi.waitFor(() => expect(h.handle.connectAgent).toHaveBeenLastCalledWith('agent-producer-2'));
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true }); // and it reloads again
    connected(); // its connect ends after the second rejoin took it off
    await flush();
    expect(h.sent('call:active')).toHaveLength(1); // the answer's
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-3' });
    await agentReady(h);
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(2));
    await flush();
    expect(h.handle.connectAgent.mock.calls).toEqual([['agent-producer'], ['agent-producer-2'], ['agent-producer-3']]);
    expect(h.sent('call:active')).toHaveLength(2);
    expect(S.markEnded).not.toHaveBeenCalled();
    expect(h.service.activeSessionCount()).toBe(1);
  });

  it("a reloaded page's last produce and resume land during the next rejoin's disconnect: void, and the newest page is connected", async () => {
    const h = harness();
    await answered(h);
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    let disconnected!: () => void;
    h.handle.disconnectAgent.mockReturnValueOnce(new Promise((r) => (disconnected = () => r(undefined))));
    // The page runs the agent's connects and disconnects one at a time: this connect waits for the disconnect before
    // it, and then finds its producer closed with the transports of its page.
    let turn!: () => void;
    const queued = new Promise<void>((r) => (turn = r));
    h.handle.connectAgent.mockImplementation(async (id: string) => {
      if (id !== 'agent-producer-2') return;
      await queued;
      if (h.room.closePeer.mock.calls.length > 1) throw new Error('Not allowed to consume this producer');
    });
    const rejoined = h.service.rejoin(as('u1'), 'c1'); // reloaded again while the page was still setting up
    await vi.waitFor(() => expect(h.handle.disconnectAgent).toHaveBeenCalledTimes(2));
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await agentReady(h); // that page's last commands land now
    disconnected();
    expect(await rejoined).toMatchObject({ ok: true });
    turn();
    await flush();
    expect(S.markEnded).not.toHaveBeenCalled();
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-3' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't3', kind: 'audio', rtpParameters: {} });
    expect(h.handle.connectAgent).not.toHaveBeenCalledWith('agent-producer-3'); // not before it listens itself
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-3' });
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(2));
    expect(h.handle.connectAgent).toHaveBeenLastCalledWith('agent-producer-3');
    expect(S.markEnded).not.toHaveBeenCalled();
    expect(h.service.activeSessionCount()).toBe(1);
  });

  it("the closed page's produce that lands during the rejoin's disconnect is void: the new page listening first does not connect it", async () => {
    const h = harness();
    await answered(h);
    let disconnected!: () => void;
    h.handle.disconnectAgent.mockReturnValueOnce(new Promise((r) => (disconnected = () => r(undefined))));
    const rejoined = h.service.rejoin(as('u1'), 'c1');
    await vi.waitFor(() => expect(h.handle.disconnectAgent).toHaveBeenCalled());
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-closed' }); // closed with the old page's transports
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    disconnected();
    expect(await rejoined).toMatchObject({ ok: true });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-2' });
    await flush();
    expect(h.handle.connectAgent).not.toHaveBeenCalledWith('agent-producer-closed');
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't2', kind: 'audio', rtpParameters: {} });
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(2));
    expect(h.handle.connectAgent).toHaveBeenLastCalledWith('agent-producer-2');
    expect(S.markEnded).not.toHaveBeenCalled();
  });

  it('a rejoin that loses to the end of its call answers not_in_call and leaves the room alone', async () => {
    const h = harness();
    await answered(h);
    let disconnected!: () => void;
    h.handle.disconnectAgent.mockReturnValueOnce(new Promise((r) => (disconnected = () => r(undefined))));
    const rejoined = h.service.rejoin(as('u1'), 'c1');
    await vi.waitFor(() => expect(h.handle.disconnectAgent).toHaveBeenCalled());
    await h.service.onEngineSignal({ profileId: 'p1', waCallId: 'W1', state: 'ended' });
    disconnected();
    expect(await rejoined).toEqual({ ok: false, reason: 'not_in_call' });
    expect(h.room.closePeer).not.toHaveBeenCalled();
  });

  it('a reloaded page rejoins: off the microphone, its transports closed, back on once it produces and listens again', async () => {
    const h = harness();
    await answered(h);
    expect(await h.service.rejoin(as('u1'), 'c1')).toEqual({
      ok: true, callId: 'c1', callerProducerId: 'caller-producer', iceServers: [{ urls: 'stun:stun.example.com:3478' }],
    });
    expect(h.handle.disconnectAgent).toHaveBeenCalled();
    expect(h.room.closePeer).toHaveBeenCalledWith('agent');
    h.agentPeer.produce.mockResolvedValueOnce({ id: 'agent-producer-2' });
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't2', kind: 'audio', rtpParameters: {} });
    expect(h.handle.connectAgent).toHaveBeenCalledTimes(1); // not before it listens again
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-2' });
    await vi.waitFor(() => expect(h.handle.connectAgent).toHaveBeenLastCalledWith('agent-producer-2'));
    await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(2));
  });

  it("rejoin: a page that already let its bridge go is fine; another failure ends the call; only one's own call", async () => {
    const h = harness();
    await answered(h);
    expect(await h.service.rejoin(as('u2'), 'c1')).toEqual({ ok: false, reason: 'not_in_call' });
    h.handle.disconnectAgent.mockRejectedValueOnce(new Error('No media bridge for this call'));
    expect(await h.service.rejoin(as('u1'), 'c1')).toMatchObject({ ok: true });
    h.handle.disconnectAgent.mockRejectedValueOnce(new Error('Target closed'));
    expect(await h.service.rejoin(as('u1'), 'c1')).toEqual({ ok: false, reason: 'media_failed' });
    expect(S.markEnded).toHaveBeenCalledWith('c1', 'server', 'media_failed', expect.any(Date));
  });
});

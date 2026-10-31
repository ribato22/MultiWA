// The call coordinator with fakes all around it (the store, the media server and room, the page's bridge, the gateway,
// the bus): who is rung and when banners close; the claim and the connecting (Task 10); every way a call ends (Task 11).
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
    linkUp: vi.fn(() => true),
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
    connectAgent: vi.fn(async () => undefined),
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
  const h = { service, gateway, bus, realtime, audit, alerts, room, agentPeer, links, callMedia, handle, media, engines, online, sent };
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

/** u1 answers c1, then plays the agent's browser: it produces its voice and resumes the caller. */
async function answered(h: ReturnType<typeof harness>) {
  expect(await h.service.answer(as('u1'), 'c1')).toMatchObject({ ok: true });
  await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
  await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
  await vi.waitFor(() => expect(h.sent('call:active')).toHaveLength(1));
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
    expect(h.sent('call:ringing')).toEqual([]);
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
  it('closes what the previous process left (answered calls, claims) at init', async () => {
    const h = harness();
    h.service.onModuleInit();
    await flush();
    expect(S.reconcileAfterRestart).toHaveBeenCalledTimes(1);
  });

  it('timings: 10 s to connect, 15 s of grace, a 120-minute cap; the env tunes them, and a bad value falls back', () => {
    expect(readCallTimings({})).toEqual({ connectMs: 10_000, agentGraceMs: 15_000, maxTalkMs: 120 * 60_000 });
    expect(readCallTimings({ CALLS_CONNECT_TIMEOUT_MS: '5000', CALLS_AGENT_GRACE_MS: 'x', CALLS_MAX_TALK_MINUTES: '30' })).toEqual({
      connectMs: 5_000, agentGraceMs: 15_000, maxTalkMs: 30 * 60_000,
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
    h.service.onModuleInit();
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

  it('WhatsApp does not answer: it is hung up all the same (its accept cannot be cancelled), released, rung again', async () => {
    const h = harness();
    h.media.answer.mockRejectedValueOnce(new Error('Call did not connect in time'));
    await h.service.answer(as('u1'), 'c1');
    await h.service.media(as('u1'), 'c1', 'produce', { transportId: 't1', kind: 'audio', rtpParameters: {} });
    await h.service.media(as('u1'), 'c1', 'resumeConsumer', { consumerId: 'consumer-1' });
    await vi.waitFor(() => expect(S.releaseClaim).toHaveBeenCalled());
    expect(h.media.hangUp).toHaveBeenCalledWith('W1');
    expect(S.markAnswered).not.toHaveBeenCalled();
    expect(h.bus.emit).toHaveBeenCalledWith('internal.calls.session', { kind: 'media_failed', reason: 'answer_failed' });
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

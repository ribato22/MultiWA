// The call coordinator end to end: a REAL mediasoup worker; a real Socket.IO server with EventsGateway and
// CallsGateway on /ws, wired by hand the way Nest's adapter wires them; socket.io-client agents on JWTs; and two
// headless Chrome pages: the engine's WhatsApp Web page (fake WhatsApp Web + the engine's hooks, driven through the
// real WebJsCallMedia) and an agent's browser (mediasoup-client), whose signalling goes through the agent's socket.
// The calls table, the users and their login sessions are in-memory stand-ins that keep the store's compare-and-set rules.
// Recorded calls go through the real CallRecorderService, on a store and a recordings table in memory.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Server } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { AppEvents } from '@multiwa/core';
import { CALL_MEDIA_INIT_SCRIPT, WebJsCallMedia, mediasoupClientBundle } from '@multiwa/engines';
import { InternalEvents } from '../../../metrics/internal-events';
import { MemoryRecordingStore } from '../../../testing/memory-recording-store';
import { EventsGateway } from '../../events/events.gateway';
import { CallsGateway } from '../calls.gateway';
import { CallMediaService } from '../media/call-media.service';
import { CallRecorderService } from '../recordings/call-recorder.service';
import { CallSessionService } from './call-session.service';
import {
  WWEBJS_USER_AGENT, agentHearsInPage, launchCallMediaBrowser, micCarriesInPage, openFakeWhatsAppPage, sineWav, sleep, startAgentPeerInPage, until,
} from '../../../testing/call-media-browser';

// sessions: by tokenHash, as the sessions table keys them
const db = vi.hoisted(() => ({
  calls: new Map<string, any>(),
  users: new Map<string, any>(),
  sessions: new Map<string, { userId: string; expiresAt: Date }>(),
  settings: new Map<string, Record<string, unknown>>(),
  recordings: new Map<string, any>(),
}));
vi.mock('@multiwa/database', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: any) => db.users.get(where.id) ?? null,
      findMany: async ({ where }: any) =>
        [...db.users.values()]
          .filter((u) => where.id.in.includes(u.id) && u.organizationId === where.organizationId && u.isActive && where.role.in.includes(u.role))
          .map((u) => ({ id: u.id })),
    },
    session: {
      findUnique: async ({ where }: any) => db.sessions.get(where.tokenHash) ?? null,
      findMany: async ({ where }: any) =>
        [...db.sessions.entries()]
          .filter(([hash, s]) => where.tokenHash.in.includes(hash) && s.expiresAt > where.expiresAt.gt && db.users.get(s.userId)?.isActive)
          .map(([tokenHash]) => ({ tokenHash })),
    },
    apiKey: { findUnique: async () => null },
    call: { findUnique: async ({ where }: any) => db.calls.get(where.id) ?? null },
    callRecording: {
      create: async ({ data }: any) => {
        if (db.recordings.has(data.callId)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        const row = { id: `rec-${data.callId}`, createdAt: new Date(), deletedAt: null, ...data };
        db.recordings.set(data.callId, row);
        return row;
      },
    },
  },
}));
vi.mock('./call-session-store', () => ({
  findCallForAnswer: async (id: string) => {
    const c = db.calls.get(id);
    return c ? { call: { ...c }, profile: { id: c.profileId, displayName: 'Line 1', settings: db.settings.get(c.profileId) ?? { callsAnswerInDashboard: true }, organizationId: 'o1' }, callerName: 'Pak Joko' } : null;
  },
  claimCall: async (id: string, userId: string) => {
    const c = db.calls.get(id);
    if (c?.outcome !== 'ringing' || c.answeredByUserId) return false;
    c.answeredByUserId = userId;
    return true;
  },
  releaseClaim: async (id: string, userId: string) => {
    const c = db.calls.get(id);
    if (!c || c.answeredByUserId !== userId || c.outcome === 'answered') return false;
    c.answeredByUserId = null;
    return true;
  },
  markAnswered: async (id: string, userId: string, at: Date) => {
    const c = db.calls.get(id);
    if (c?.outcome !== 'ringing' || c.answeredByUserId !== userId) return null;
    Object.assign(c, { outcome: 'answered', answeredAt: at, followUp: 'done' });
    return { ...c };
  },
  markEnded: async (id: string, endedBy: string, endReason: string, at: Date) => {
    const c = db.calls.get(id);
    if (c?.outcome !== 'answered' || c.endedAt) return null;
    Object.assign(c, { endedAt: at, endedBy, endReason, talkSeconds: Math.round((at.getTime() - c.answeredAt.getTime()) / 1000) });
    return { ...c };
  },
  reconcileAfterRestart: async () => ({ ended: [], released: 0 }),
}));
vi.mock('../../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('./call-alerts', () => ({ CallAlerts: class {} }));

const SECRET = 'call-session-integration-secret';
const PRESENT = 0.05;
// A recorded profile: the recorder keys files by uuid, and plays an announcement only from the profile's own key.
const RECORDED = '22222222-2222-4222-8222-222222222222';
const ANNOUNCEMENT_KEY = `announcements/11111111-1111-4111-8111-111111111111/${RECORDED}/44444444-4444-4444-8444-444444444444.wav`;
const recordedSettings = (durationSec: number) => ({
  callsAnswerInDashboard: true, callsRecording: true, callsAnnouncement: { storageKey: ANNOUNCEMENT_KEY, mimeType: 'audio/wav', durationSec },
});

/**
 * Page function: a stored recording, decoded. Its tones in the first second (after its start) and its last, per
 * channel; the length an <audio> element reads (Infinity, sent as null, without a Duration), and the decoded audio's.
 */
async function recordingInPage(b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/webm' })));
  await new Promise((resolve, reject) => {
    audio.onloadedmetadata = resolve;
    audio.onerror = () => reject(new Error('the recording does not load'));
  });
  const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.buffer);
  const tone = (x: Float32Array, hz: number) => {
    const w = (2 * Math.PI * hz) / buf.sampleRate;
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    return Math.hypot(re, im) / x.length;
  };
  const span = (from: number, to: number) => {
    const [L, R] = [0, 1].map((c) => buf.getChannelData(c).subarray(Math.floor(from * buf.sampleRate), Math.floor(to * buf.sampleRate)));
    return { l440: tone(L, 440), l550: tone(L, 550), l660: tone(L, 660), r440: tone(R, 440), r550: tone(R, 550), r660: tone(R, 660) };
  };
  return {
    channels: buf.numberOfChannels, duration: audio.duration, decoded: buf.duration, early: span(0.3, 1.2), late: span(buf.duration - 1, buf.duration),
  };
}

describe('call coordinator end to end (real mediasoup worker, Socket.IO, two headless Chromes)', () => {
  const jwt = new JwtService({});
  const userSockets = new Map<string, ClientSocket[]>();
  const published: Array<[string, any]> = [];
  let bus: EventEmitter2;
  let events: EventsGateway;
  let sessions: CallSessionService;
  let callMedia: CallMediaService;
  let http: HttpServer;
  let ioServer: Server;
  let url = '';
  let launched: Awaited<ReturnType<typeof launchCallMediaBrowser>>;
  let waPage: any;
  let media: WebJsCallMedia;
  let store: MemoryRecordingStore;
  const recorderAlerts = { recordingFailed: vi.fn(async (_kind: string, _profileId: string) => undefined) };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    vi.stubEnv('JWT_SECRET', SECRET);
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'true');
    vi.stubEnv('CALLS_MEDIA_ANNOUNCED_ADDRESS', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_LISTEN_IP', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_PORT', String(48000 + Math.floor(Math.random() * 1500))); // apart from the other media specs' ports
    vi.stubEnv('CALLS_CONNECT_TIMEOUT_MS', '6000');
    vi.stubEnv('CALLS_AGENT_GRACE_MS', '4000');
    db.users.set('u1', { id: 'u1', name: 'Ana', role: 'owner', isActive: true, organizationId: 'o1' });
    db.users.set('u2', { id: 'u2', name: 'Budi', role: 'member', isActive: true, organizationId: 'o1' });
    bus = new EventEmitter2();
    for (const e of [AppEvents.CALL.ANSWERED, AppEvents.CALL.ENDED, AppEvents.CALL.RECORDING_READY]) bus.on(e, (p) => published.push([e, p]));
    callMedia = new CallMediaService(bus);
    await callMedia.onModuleInit();
    launched = await launchCallMediaBrowser();
    waPage = await openFakeWhatsAppPage(launched.browser, launched.url, CALL_MEDIA_INIT_SCRIPT, (p: any) => p.setUserAgent(WWEBJS_USER_AGENT));
    media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    await media.preparePage(); // as the engine does on every ready: an unprepared page is never answerable (not_prepared)
    events = new EventsGateway(jwt, bus);
    const audit = { log: vi.fn(async () => undefined) };
    const alerts = { workerDied: vi.fn(async () => undefined) };
    store = new MemoryRecordingStore();
    store.tmpDir = mkdtempSync(join(tmpdir(), 'calls-recorded-'));
    const recorder = new CallRecorderService(store, { storageStatus: () => ({ lastCheck: null }) } as any, recorderAlerts as any, bus, events);
    sessions = new CallSessionService(callMedia, { getEngine: () => ({ callMedia: media }) } as any, events, bus, events, audit as any, alerts as any, recorder);
    const gateway = new CallsGateway(events, sessions);
    // What Nest's event-emitter module does for the coordinator's @OnEvent handlers, and its lifecycle hooks
    bus.on(AppEvents.CALL.RECEIVED, (p) => void sessions.onCallReceived(p));
    for (const e of [AppEvents.CALL.ENDED, AppEvents.CALL.REJECTED, AppEvents.CALL.UPDATED]) bus.on(e, (p) => sessions.onCallChanged(p));
    bus.on(InternalEvents.CALL_ENGINE_SIGNAL, (p) => void sessions.onEngineSignal(p));
    bus.on(AppEvents.CONNECTION.DISCONNECTED, (p) => void sessions.onProfileDisconnected(p));
    bus.on(InternalEvents.WS_USER_ONLINE, (p) => sessions.onUserOnline(p));
    bus.on(InternalEvents.WS_USER_OFFLINE, (p) => sessions.onUserOffline(p));
    sessions.onModuleInit();
    sessions.onApplicationBootstrap();
    // What Nest's socket.io adapter does for the two gateways on /ws
    http = createServer();
    ioServer = new Server(http);
    const nsp = ioServer.of('/ws');
    events.server = nsp as any;
    const commands: Record<string, string> = {
      'call:answer': 'answer', 'call:media': 'media', 'call:rejoin': 'rejoin', 'call:hangup': 'hangup', 'call:availability': 'availability',
    };
    nsp.on('connection', (socket) => {
      void events.handleConnection(socket as any);
      socket.on('disconnect', () => events.handleDisconnect(socket as any));
      for (const [event, method] of Object.entries(commands)) {
        socket.on(event, async (body: unknown, ack?: (reply: unknown) => void) => ack?.(await (gateway as any)[method](socket, body)));
      }
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as any).port}/ws`;
  }, 90_000);

  afterAll(async () => {
    for (const list of userSockets.values()) for (const s of list) s.disconnect();
    await sessions?.onModuleDestroy();
    ioServer?.close();
    await launched?.close();
    await callMedia?.onModuleDestroy();
    if (store) rmSync(store.tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  /** An agent's socket (JWT login, with its session) and everything it was sent. */
  const agent = async (userId: string) => {
    const token = jwt.sign({ sub: userId }, { secret: SECRET });
    db.sessions.set(createHash('sha256').update(token).digest('hex'), { userId, expiresAt: new Date(Date.now() + 3_600_000) });
    const socket = io(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    userSockets.set(userId, [...(userSockets.get(userId) ?? []), socket]);
    const got: Array<[string, any]> = [];
    socket.onAny((event: string, payload: any) => got.push([event, payload]));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    expect(await until(() => events.isUserOnline(userId), 3000)).toBe(true);
    return {
      socket,
      sent: (event: string, callId?: string) => got.filter(([e, p]) => e === event && (!callId || p?.callId === callId)).map(([, p]) => p),
      /** The names of the events about `callId`, in the order they came. */
      names: (callId: string) => got.filter(([, p]) => p?.callId === callId).map(([e]) => e),
    };
  };

  /** An agent's browser: mediasoup-client, its signalling through the agent's socket (call:media). */
  const agentPage = async (socket: ClientSocket, callId: string) => {
    const page = await launched.browser.newPage();
    await page.exposeFunction('__agentSignal', async (op: string, json: string) => {
      const ack: any = await socket.emitWithAck('call:media', { callId, op, ...JSON.parse(json) });
      if (!ack.ok) throw new Error(ack.message ?? ack.reason);
      return JSON.stringify(ack.result ?? null);
    });
    await page.goto(launched.url);
    await page.evaluate(mediasoupClientBundle());
    return page;
  };

  let seq = 0;
  /** A call rings: on the fake WhatsApp Web, in the calls table, and on the bus (as the call runtime publishes it). */
  const ring = async (profileId = 'p1') => {
    seq++;
    const waCallId = `CALL${seq}`;
    const callId = randomUUID(); // as the calls table makes them: the recorder names a recording's files by it
    await waPage.evaluate((id: string) => (window as any).__fakeWa.ring(id), waCallId);
    db.calls.set(callId, {
      id: callId, profileId, waCallId, fromJid: '628111000111@c.us', isVideo: false, isGroup: false, outcome: 'ringing',
      answeredByUserId: null, startedAt: new Date(), endedAt: null, followUp: 'open',
    });
    bus.emit(AppEvents.CALL.RECEIVED, { callId, profileId });
    return { callId, waCallId };
  };
  const whatsAppEnds = (): Promise<number> => waPage.evaluate(() => (window as any).__fakeWa.endCalls.length);

  /** `who` answers `callId` and connects its browser (the agent's voice at `hz`); resolves once the call is active. */
  const talk = async (who: Awaited<ReturnType<typeof agent>>, callId: string, hz: number) => {
    const page = await agentPage(who.socket, callId);
    const ack: any = await who.socket.emitWithAck('call:answer', { callId });
    expect(ack).toMatchObject({ ok: true, callId });
    await page.evaluate(startAgentPeerInPage, ack.callerProducerId, hz);
    expect(await until(() => who.sent('call:active', callId).length > 0, 8000)).toBe(true);
    return { page, ack };
  };

  /** `callId`'s files in the store's tmpDir: a scenario looks at its own call's only, whatever an earlier one left. */
  const tmpFilesOf = (callId: string) => readdirSync(store.tmpDir).filter((n) => n.startsWith(callId));
  /**
   * Hangs `callId` up through `who`'s socket while it is still up, whatever the reply: a scenario that stopped early
   * leaves no call up and no agent busy for the next one.
   */
  const hangUpIfUp = async (who: Awaited<ReturnType<typeof agent>>, callId: string) => {
    if (!db.calls.get(callId)?.endedAt) await who.socket.timeout(5000).emitWithAck('call:hangup', { callId }).catch(() => undefined);
  };

  it('two agents answer at once: one gets the call, the other is told who; they hear each other; Hang up ends it everywhere', async () => {
    const ana = await agent('u1');
    const budi = await agent('u2');
    const { callId } = await ring();
    expect(await until(() => ana.sent('call:ringing', callId).length > 0 && budi.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
    expect(ana.sent('call:ringing', callId)[0]).toMatchObject({ answerable: true, profileName: 'Line 1', caller: { name: 'Pak Joko', number: '628111000111' } });
    const pages = [await agentPage(ana.socket, callId), await agentPage(budi.socket, callId)];
    const [a, b]: any[] = await Promise.all([ana.socket.emitWithAck('call:answer', { callId }), budi.socket.emitWithAck('call:answer', { callId })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const [winner, loser, page, ack] = a.ok ? [ana, budi, pages[0], a] : [budi, ana, pages[1], b];
    expect((a.ok ? b : a).reason).toBe('already_claimed');
    expect(await until(() => loser.sent('call:claimed', callId).length > 0, 3000)).toBe(true);
    expect(loser.sent('call:claimed', callId)[0]).toMatchObject({ byUserName: winner === ana ? 'Ana' : 'Budi' });
    await page.evaluate(startAgentPeerInPage, ack.callerProducerId, 660);
    expect(await until(() => winner.sent('call:active', callId).length > 0, 8000)).toBe(true);
    expect(db.calls.get(callId)).toMatchObject({ outcome: 'answered', followUp: 'done' });
    expect(published.some(([e, p]) => e === 'call.answered' && p.callId === callId)).toBe(true);
    // the agent hears the caller (440 Hz); WhatsApp's microphone carries the agent (660 Hz)
    expect(await until(async () => (await page.evaluate(agentHearsInPage, 440)) > PRESENT, 10_000)).toBe(true);
    expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
    const ends = await whatsAppEnds();
    expect(await winner.socket.emitWithAck('call:hangup', { callId })).toEqual({ ok: true });
    expect(winner.sent('call:ended', callId).slice(-1)[0]).toMatchObject({ endedBy: 'agent', endReason: 'hangup' });
    expect(await whatsAppEnds()).toBe(ends + 1); // WhatsApp's own End
    expect(db.calls.get(callId)).toMatchObject({ endedBy: 'agent', endReason: 'hangup' });
    expect(published.some(([e, p]) => e === 'call.ended' && p.callId === callId && p.endReason === 'hangup')).toBe(true);
    expect(sessions.activeSessionCount()).toBe(0);
    for (const p of pages) await p.close();
  }, 60_000);

  it('an agent whose audio never connects: the claim goes back in time and the call rings again; the caller giving up closes the banners', async () => {
    const ana = await agent('u1');
    const { callId } = await ring();
    expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
    expect(await ana.socket.emitWithAck('call:answer', { callId })).toMatchObject({ ok: true }); // and no media ops follow
    expect(await until(() => ana.sent('call:ended', callId).some((p) => p.endReason === 'media_failed'), 9000)).toBe(true);
    expect(db.calls.get(callId).answeredByUserId).toBeNull();
    expect(await until(() => ana.sent('call:ringing', callId).length === 2, 3000)).toBe(true);
    db.calls.get(callId).outcome = 'missed';
    bus.emit(AppEvents.CALL.ENDED, { callId, outcome: 'missed' }); // as the runtime publishes the caller giving up
    expect(await until(() => ana.sent('call:ended', callId).some((p) => p.outcome === 'missed'), 3000)).toBe(true);
  }, 30_000);

  it('the caller hangs up: the call ends as caller_hangup, and nothing hangs it up again', async () => {
    const ana = await agent('u1');
    const { callId, waCallId } = await ring();
    expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
    const { page } = await talk(ana, callId, 660);
    // The page refuses to hang up a call it no longer holds, so its End count cannot tell: ask the engine.
    const hangUp = vi.spyOn(media, 'hangUp');
    // On the phone: WhatsApp Web lets the call go, and the engine reports it ended.
    await waPage.evaluate(async () => {
      const w = window as any;
      w.require('WAWebCallCollection').activeCall = null;
      await w.__fakeWa.stopPlaybacks();
    });
    bus.emit(InternalEvents.CALL_ENGINE_SIGNAL, { profileId: 'p1', waCallId, state: 'ended' });
    expect(await until(() => ana.sent('call:ended', callId).length > 0, 5000)).toBe(true);
    expect(ana.sent('call:ended', callId).slice(-1)[0]).toMatchObject({ endedBy: 'caller', endReason: 'caller_hangup' });
    expect(hangUp).not.toHaveBeenCalled();
    hangUp.mockRestore();
    await page.close();
  }, 60_000);

  it('a reloaded agent page rejoins its call and is heard again', async () => {
    const ana = await agent('u1');
    const { callId } = await ring();
    expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
    const { page, ack } = await talk(ana, callId, 660);
    expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
    await page.close(); // the agent reloads
    const again: any = await ana.socket.emitWithAck('call:rejoin', { callId });
    expect(again).toMatchObject({ ok: true, callerProducerId: ack.callerProducerId });
    const page2 = await agentPage(ana.socket, callId);
    await page2.evaluate(startAgentPeerInPage, again.callerProducerId, 770);
    expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 770)) > PRESENT, 10_000)).toBe(true);
    expect(await until(async () => (await page2.evaluate(agentHearsInPage, 440)) > PRESENT, 10_000)).toBe(true);
    expect(await ana.socket.emitWithAck('call:hangup', { callId })).toEqual({ ok: true });
    await page2.close();
  }, 60_000);

  it("the agent's every socket goes away: after the grace the call is hung up as agent_lost", async () => {
    const ana = await agent('u1');
    const { callId } = await ring();
    expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
    const { page } = await talk(ana, callId, 660);
    const ends = await whatsAppEnds();
    for (const s of userSockets.get('u1') ?? []) s.disconnect();
    expect(await until(() => db.calls.get(callId).endReason === 'agent_lost', 9000)).toBe(true);
    expect(db.calls.get(callId)).toMatchObject({ endedBy: 'server' });
    expect(await whatsAppEnds()).toBe(ends + 1);
    await page.close();
  }, 30_000);

  it('a recorded call: the caller hears the announcement first, then the agent; the stored recording keeps them apart, with its length', async () => {
    db.settings.set(RECORDED, recordedSettings(1.5));
    store.file(ANNOUNCEMENT_KEY, sineWav(550, 1.5));
    recorderAlerts.recordingFailed.mockClear();
    const ana = await agent('u1');
    const { callId } = await ring(RECORDED);
    try {
      expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
      expect(ana.sent('call:ringing', callId)[0]).toMatchObject({ recorded: true, answerable: true });
      // The agent is connected only once the announcement has played. The page mutes the agent input while one plays, so
      // neither the line nor the recording would show an agent connected sooner: the page's bridge does. A failure says
      // which it was: no announcement came, there was no bridge to look at, or the agent was on it.
      const agentDuringAnnouncement = until(() => ana.sent('call:announcing', callId).length > 0, 8000).then((announced) =>
        announced ? waPage.evaluate(() => { const b = (window as any).__mwBridge; return b ? !!b.agent : 'no bridge'; }) : 'not announced',
      );
      const { page } = await talk(ana, callId, 660);
      expect(await agentDuringAnnouncement).toBe(false);
      expect(ana.sent('call:announcing', callId)).toEqual([{ callId, durationSec: 1.5 }]);
      expect(ana.names(callId).indexOf('call:announcing')).toBeLessThan(ana.names(callId).indexOf('call:active'));
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
      await sleep(1500); // the agent's voice, long enough for the recording's last second
      expect(await ana.socket.emitWithAck('call:hangup', { callId })).toEqual({ ok: true });
      expect(await until(() => db.recordings.has(callId), 15_000)).toBe(true);
      const rec = db.recordings.get(callId);
      expect(rec).toMatchObject({ profileId: RECORDED, announcementPlayed: true, partial: false, channels: 2, storageType: 'local', storageLocation: 'memory:test' });
      const heard = await page.evaluate(recordingInPage, store.files.get(rec.storageKey)!.body.toString('base64'));
      expect(heard.channels).toBe(2);
      expect(Number.isFinite(heard.duration)).toBe(true); // the Duration is written in...
      expect(Math.abs(heard.duration - heard.decoded)).toBeLessThan(0.1); // ...and it is the audio's own length
      expect(rec.durationSec).toBe(Math.round(heard.duration));
      expect(heard.early.l440).toBeGreaterThan(0.01); // left: the caller, from the start
      expect(heard.early.r550).toBeGreaterThan(heard.early.r660 * 3); // right: the announcement first...
      expect(heard.late.r660).toBeGreaterThan(heard.late.r550 * 3); // ...then the agent
      // Each on its own channel: a recording that mixed them would still carry every tone above.
      expect(heard.early.r440).toBeLessThan(heard.early.l440 / 10);
      expect(heard.early.l550).toBeLessThan(heard.early.r550 / 10);
      expect(heard.late.l660).toBeLessThan(heard.late.r660 / 10);
      expect(published.some(([e, p]) => e === AppEvents.CALL.RECORDING_READY && p.callId === callId && p.recordingId === rec.id)).toBe(true);
      expect(await until(() => !tmpFilesOf(callId).length, 5000)).toBe(true); // its files go just after its row
      expect(recorderAlerts.recordingFailed).not.toHaveBeenCalled(); // a call that went well alerts nobody
      await page.close();
    } finally {
      await hangUpIfUp(ana, callId);
    }
  }, 60_000);

  it('an announcement that does not play: the agent is connected all the same, nothing is kept, the admins are told once', async () => {
    db.settings.set(RECORDED, recordedSettings(1.5));
    store.file(ANNOUNCEMENT_KEY, Buffer.from('not audio'));
    recorderAlerts.recordingFailed.mockClear();
    const ana = await agent('u1');
    const { callId } = await ring(RECORDED);
    try {
      expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
      const { page } = await talk(ana, callId, 660);
      // The alert follows the failed recording's cleanup, which goes on beside the agent's connect.
      expect(await until(() => recorderAlerts.recordingFailed.mock.calls.length > 0, 5000)).toBe(true);
      expect(recorderAlerts.recordingFailed).toHaveBeenCalledWith('announcement_failed', RECORDED);
      expect(recorderAlerts.recordingFailed).toHaveBeenCalledTimes(1);
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
      expect(await ana.socket.emitWithAck('call:hangup', { callId })).toEqual({ ok: true });
      await sleep(1000);
      expect(db.recordings.has(callId)).toBe(false);
      expect(tmpFilesOf(callId)).toEqual([]);
      await page.close();
    } finally {
      await hangUpIfUp(ana, callId);
    }
  }, 60_000);

  it('the caller hangs up during the announcement: nothing is kept, nobody is told, and the line is free for the next call', async () => {
    // Far longer than the 3 s the check below gives it to stop: only a page that cuts it off at the call's end passes,
    // never one that lets it play on to its end.
    db.settings.set(RECORDED, recordedSettings(12));
    store.file(ANNOUNCEMENT_KEY, sineWav(550, 12));
    recorderAlerts.recordingFailed.mockClear();
    const ana = await agent('u1');
    const { callId, waCallId } = await ring(RECORDED);
    try {
      expect(await until(() => ana.sent('call:ringing', callId).length > 0, 5000)).toBe(true);
      const page = await agentPage(ana.socket, callId);
      const ack: any = await ana.socket.emitWithAck('call:answer', { callId });
      expect(ack).toMatchObject({ ok: true });
      await page.evaluate(startAgentPeerInPage, ack.callerProducerId, 660);
      expect(await until(() => ana.sent('call:announcing', callId).length > 0, 8000)).toBe(true);
      // On the phone: WhatsApp Web lets the call go, and the engine reports it ended.
      await waPage.evaluate(async () => {
        const w = window as any;
        w.require('WAWebCallCollection').activeCall = null;
        await w.__fakeWa.stopPlaybacks();
      });
      bus.emit(InternalEvents.CALL_ENGINE_SIGNAL, { profileId: RECORDED, waCallId, state: 'ended' });
      expect(await until(() => ana.sent('call:ended', callId).length > 0, 5000)).toBe(true);
      // the announcement ended with its call: the line is free, and the agent input has its gain back
      expect(await until(() => waPage.evaluate(() => { const c = (window as any).__mwCall; return c.announcing === false && c.inputs.agent.gain.value === 1; }), 3000)).toBe(true);
      // What is checked below is settled once the recording's drop deleted its files, after its recorder stopped.
      await until(() => !tmpFilesOf(callId).length, 5000);
      expect(db.recordings.has(callId)).toBe(false);
      expect(recorderAlerts.recordingFailed).not.toHaveBeenCalled();
      expect(tmpFilesOf(callId)).toEqual([]);
      expect(ana.sent('call:active', callId)).toEqual([]);
      await page.close();
    } finally {
      await hangUpIfUp(ana, callId);
    }
  }, 60_000);
});

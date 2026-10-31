// MultiWA Gateway - the call coordinator: incoming calls answered in the dashboard
// apps/api/src/modules/calls/coordinator/call-session.service.ts
//
// A call of a profile with dashboard answering on rings every eligible agent online: an active owner, admin or member
// of its organization, available, not on a call. The first Answer claims it (calls.answeredByUserId), and its audio
// connects within CALLS_CONNECT_TIMEOUT_MS: a media room, the page's bridge, the agent's transports, and only then
// WhatsApp's own Accept. A claim whose audio does not connect is given back, and the call rings again unless it was
// hung up. Once WhatsApp has answered, the call ends with the agent's Hang up, the caller's, the talk-time cap, an agent
// lost for CALLS_AGENT_GRACE_MS, or a media failure (the page's media link down as long, too): every end hangs up what
// WhatsApp still holds, closes the media, and stores who ended it and why.
// Sessions live in this process, with the engines and the media server they use: a restart ends them, and the next
// boot closes their rows.
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { AppEvents, REALTIME_EMITTER, type RealtimeEmitter } from '@multiwa/core';
import { publishCall, withTimeout, type CallRecord } from '@multiwa/engine-runtime';
import { runCallMediaSignal, type CallMediaEngine, type CallMediaHandle, type CallMediaSignaling } from '@multiwa/engines';
import { EngineManagerService } from '../../profiles/engine-manager.service';
import { EventsGateway, type SocketPrincipal } from '../../events/events.gateway';
import { AuditService } from '../../audit/audit.service';
import { CallMediaService } from '../media/call-media.service';
import type { CallMediaRoom } from '../media/call-media-room';
import { InternalEvents, type CallEngineSignalPayload, type CallMediaFailureReason, type CallsSessionPayload, type WsUserPayload } from '../../../metrics/internal-events';
import { isWorkerEngine } from '../../../common/engine-host';
import { checkReadiness, type CallReadiness } from './call-readiness';
import { CallAlerts } from './call-alerts';
import { claimCall, findCallForAnswer, markAnswered, markEnded, reconcileAfterRestart, releaseClaim, type CallEndReason, type CallEndedBy } from './call-session-store';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const message = (e: unknown) => clean((e as Error)?.message ?? e);

/** Who may answer calls: never a viewer. */
const AGENT_ROLES = ['owner', 'admin', 'member'];

// Bounds on the page calls: a hung page would otherwise hold each of them for puppeteer's protocol timeout (240 s).
const ATTACH_MS = 8_000; // attachCaller itself waits up to 5 s for the caller's audio
const AGENT_CONNECT_MS = 8_000;
const HANGUP_MS = 12_000; // the voip stack's own limit is 10 s
const TEARDOWN_MS = 5_000;

/** Why a session's audio did not connect, or broke: the media-failure counter's reason. */
type MediaFailure = CallMediaFailureReason;

/** A command's ack. */
export type CallCommandReply<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string; message?: string };

export interface CallTimings {
  /** From the claim to the agent's audio connected (CALLS_CONNECT_TIMEOUT_MS). */
  connectMs: number;
  /** How long an agent may be lost before the call is hung up (CALLS_AGENT_GRACE_MS). */
  agentGraceMs: number;
  /** The talk-time cap (CALLS_MAX_TALK_MINUTES). */
  maxTalkMs: number;
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** setTimeout's longest delay: a longer one fires after 1 ms. */
const timerMs = (ms: number) => Math.min(ms, 2 ** 31 - 1);

export function readCallTimings(env: NodeJS.ProcessEnv = process.env): CallTimings {
  return {
    connectMs: timerMs(positive(env.CALLS_CONNECT_TIMEOUT_MS, 10_000)),
    agentGraceMs: timerMs(positive(env.CALLS_AGENT_GRACE_MS, 15_000)),
    maxTalkMs: timerMs(positive(env.CALLS_MAX_TALK_MINUTES, 120) * 60_000),
  };
}

/** The number a banner shows, from a phone JID; a LID is not a number. */
const callerNumber = (jid: string) => (/@(c\.us|s\.whatsapp\.net)$/.test(jid) ? jid.split('@')[0] : null);

interface Session {
  /** The calls row id: the room's key, and the id in every socket payload. */
  callId: string;
  /** The engine's id of the call, for its media methods. */
  waCallId: string;
  profileId: string;
  organizationId: string;
  userId: string;
  startedAt: Date;
  /** When the connect budget (CALLS_CONNECT_TIMEOUT_MS from the claim) runs out, in epoch ms. */
  connectDeadline: number;
  media: CallMediaEngine;
  /** Active from WhatsApp's accept on: every stop is then an end. */
  phase: 'connecting' | 'active' | 'ending';
  room: CallMediaRoom | null;
  handle: CallMediaHandle | null;
  /** The room's agent peer, watched: the agent is ready once it has produced its voice and resumed the caller. */
  agent: CallMediaSignaling | null;
  agentProducerId: string | null;
  agentListening: boolean;
  ready: { promise: Promise<string>; resolve: (agentProducerId: string) => void; reject: (e: Error) => void };
  /** engine.answer was called: WhatsApp may hold the call from then on (its accept cannot be cancelled). */
  answerTried: boolean;
  answeredAt: Date | null;
  /** The answer's write (markAnswered), from WhatsApp's accept on: null once it did not store. An end waits for it. */
  answering: Promise<CallRecord | null> | null;
  /** A reloaded agent page is producing anew (call:rejoin). */
  rejoining: boolean;
  socketsLost: boolean;
  linkLost: boolean;
  timers: { connect?: NodeJS.Timeout; grace?: NodeJS.Timeout; talk?: NodeJS.Timeout; page?: NodeJS.Timeout };
}

@Injectable()
export class CallSessionService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CallSessionService.name);
  private readonly timing = readCallTimings();
  /** The calls being answered (connecting or talking), by calls row id. */
  private readonly sessions = new Map<string, Session>();
  /** The users each ringing call rang: they hear when it is claimed or stops ringing. */
  private readonly rung = new Map<string, Set<string>>();
  /** Users who turned themselves unavailable. They are available again once their last socket goes. */
  private readonly unavailable = new Set<string>();
  /** Users whose Answer is claiming a call: busy before their session exists. */
  private readonly claiming = new Set<string>();

  constructor(
    private readonly callMedia: CallMediaService,
    @Inject(forwardRef(() => EngineManagerService)) private readonly engines: EngineManagerService,
    private readonly gateway: EventsGateway,
    private readonly eventEmitter: EventEmitter2,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
    private readonly audit: AuditService,
    private readonly alerts: CallAlerts,
  ) {}

  onModuleInit(): void {
    // The rooms a dead worker carried are gone: their calls end (or ring again while connecting), and the admins are told.
    this.callMedia.events.on('worker-died', (callIds: string[]) => void this.onWorkerDied(callIds));
  }

  onApplicationBootstrap(): void {
    // Once every module is initialized: the call.ended it publishes must reach the webhook dispatcher, which subscribes
    // in its onModuleInit. Not awaited, so that a slow calls table does not hold the boot: it can still be running when
    // the app takes calls, and that is safe, as both of its writes touch only rows from before `at`.
    reconcileAfterRestart(new Date())
      .then(({ ended, released }) => {
        // Every call.answered gets its call.ended: the previous process went before it could send these.
        for (const row of ended) publishCall(this.callDeps(row.profileId), AppEvents.CALL.ENDED, row);
        if (ended.length || released) this.logger.log(`Calls of the previous process: ${ended.length} answered call(s) ended, ${released} claim(s) released`);
      })
      .catch((e) => this.logger.warn(`Call reconciliation failed: ${message(e)}`));
  }

  /** Shutdown: the engines and the media server go with the process. Answered calls are stored as ended, claims given back. */
  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((s) =>
        s.phase === 'connecting' ? this.stopConnecting(s, { reRing: false, hangUp: false }) : this.end(s, 'server', 'server_restart'),
      ),
    );
  }

  /** Sessions in progress, connecting or talking. */
  activeSessionCount(): number {
    return this.sessions.size;
  }

  /** Whether the profile's calls can be answered in the dashboard now, and why not. */
  readiness(profileId: string, settings: Record<string, unknown>): Promise<CallReadiness> {
    return checkReadiness(settings, {
      engineHostWorker: isWorkerEngine(),
      media: this.callMedia.publicStatus(),
      engine: this.engines.getEngine(profileId),
    });
  }

  /** "Available for calls": an unavailable agent is not rung. Their other tabs are told. */
  async setAvailability(principal: SocketPrincipal, available: unknown): Promise<CallCommandReply<{ available: boolean }>> {
    const user = await this.agentOf(principal);
    if (!user) return { ok: false, reason: 'not_allowed' };
    if (typeof available !== 'boolean') return { ok: false, reason: 'invalid' };
    if (available) this.unavailable.delete(user.id);
    else this.unavailable.add(user.id);
    this.gateway.emitToUsers([user.id], 'call:availability', { available });
    return { ok: true, available };
  }

  /**
   * An agent pressed Answer: claim the call, open its media room and start the page's bridge, then ack with what the
   * agent's browser needs (the caller's producer, the ICE servers). The rest runs on (connect): the agent's media ops
   * (call:media), WhatsApp's Accept, the caller attached, the agent on the microphone, call:active.
   */
  async answer(principal: SocketPrincipal, callId: unknown): Promise<CallCommandReply<{ callId: string; callerProducerId: string; iceServers: unknown[] }>> {
    const user = await this.agentOf(principal);
    if (!user || typeof callId !== 'string') return { ok: false, reason: 'not_allowed' };
    const found = await findCallForAnswer(callId);
    if (!found || found.profile.organizationId !== user.organizationId) return { ok: false, reason: 'not_allowed' };
    const { call, profile } = found;
    if (call.outcome !== 'ringing') return { ok: false, reason: 'not_ringing' };
    if (call.answeredByUserId) return { ok: false, reason: 'already_claimed' };
    if (this.busy(user.id)) return { ok: false, reason: 'busy' };
    const media = this.engines.getEngine(profile.id)?.callMedia;
    if (profile.settings.callsAnswerInDashboard !== true || call.isVideo || call.isGroup || !media || this.callMedia.publicStatus().worker !== 'up') {
      return { ok: false, reason: 'media_unavailable' };
    }
    // Busy from the check above on, nothing awaited in between: two Answers of one agent cannot both claim.
    this.claiming.add(user.id);
    let session: Session;
    try {
      if (!(await claimCall(call.id, user.id))) {
        const now = await findCallForAnswer(call.id);
        return { ok: false, reason: now?.call.outcome === 'ringing' ? 'already_claimed' : 'not_ringing' };
      }
      session = this.open(call, user.organizationId, user.id, media);
    } finally {
      this.claiming.delete(user.id);
    }
    const others = [...(this.rung.get(call.id) ?? [])].filter((id) => id !== user.id);
    this.gateway.emitToUsers(others, 'call:claimed', { callId: call.id, byUserId: user.id, byUserName: user.name });
    let handle: CallMediaHandle;
    try {
      const room = await this.callMedia.createRoom(call.id);
      if (session.phase !== 'connecting') {
        room.close(); // the session ended while the room was being made
        return { ok: false, reason: 'media_failed' };
      }
      session.room = room;
      session.agent = this.watchedAgent(session, room.signalingFor('agent'));
      handle = await withTimeout(media.startCallMedia(call.waCallId, room.signalingFor('page')), this.timing.connectMs, 'the media bridge did not start in time');
      session.handle = handle;
    } catch (e) {
      await this.stopConnecting(session, { failure: 'page_start_failed', error: e, reRing: true });
      return { ok: false, reason: 'media_failed' };
    }
    if (session.phase !== 'connecting') return { ok: false, reason: 'media_failed' }; // ended meanwhile: the timeout, or the call stopped ringing
    void this.connect(session);
    return { ok: true, callId: call.id, callerProducerId: handle.callerProducerId, iceServers: this.callMedia.iceServers() };
  }

  /** One of the agent's mediasoup signalling operations, on its own session's room only. */
  async media(principal: SocketPrincipal, callId: unknown, op: unknown, args: unknown): Promise<CallCommandReply<{ result: unknown }>> {
    const own = await this.ownSession(principal, callId);
    if (!own.ok) return own;
    if (!own.session.agent || typeof op !== 'string') return { ok: false, reason: 'not_in_call' };
    try {
      return { ok: true, result: (await runCallMediaSignal(own.session.agent, op, args)) ?? null };
    } catch (e) {
      return { ok: false, reason: 'media_error', message: message(e) };
    }
  }

  /**
   * The agent's Hang up. While connecting it gives the call up, and the call rings again for everyone. Also for an agent
   * deactivated or demoted since the answer: every other command refuses them, and their call would run on to the cap.
   */
  async hangup(principal: SocketPrincipal, callId: unknown): Promise<CallCommandReply> {
    const session = this.sessionOf(principal, callId);
    if (!session) return { ok: false, reason: (await this.agentOf(principal)) ? 'not_in_call' : 'not_allowed' };
    if (session.phase === 'connecting') await this.stopConnecting(session, { reRing: true });
    else await this.end(session, 'agent', 'hangup');
    return { ok: true };
  }

  /**
   * A reloaded agent page joins its call again: the old agent goes off the microphone and its transports are closed,
   * and the reply carries what the page needs to produce anew. Once it has produced and listens, it is back on.
   */
  async rejoin(principal: SocketPrincipal, callId: unknown): Promise<CallCommandReply<{ callId: string; callerProducerId: string; iceServers: unknown[] }>> {
    const own = await this.ownSession(principal, callId);
    if (!own.ok) return own;
    const { session } = own;
    if (session.phase !== 'active' || !session.handle || !session.room) return { ok: false, reason: 'not_in_call' };
    session.rejoining = true;
    session.agentProducerId = null;
    session.agentListening = false;
    try {
      await withTimeout(session.handle.disconnectAgent(), AGENT_CONNECT_MS);
    } catch (e) {
      // "No media bridge": the page let its bridge go, the call is over and its end is on its way. Anything else broke it.
      if (!/No media bridge/.test(message(e))) {
        await this.end(session, 'server', 'media_failed', { failure: 'agent_connect_failed', error: e });
        return { ok: false, reason: 'media_failed' };
      }
    }
    if (session.phase !== 'active') return { ok: false, reason: 'not_in_call' }; // it ended meanwhile
    session.room.closePeer('agent');
    session.socketsLost = false; // it is talking to us
    this.updateGrace(session);
    return { ok: true, callId: session.callId, callerProducerId: session.handle.callerProducerId, iceServers: this.callMedia.iceServers() };
  }

  @OnEvent(AppEvents.CALL.RECEIVED)
  async onCallReceived(payload: { callId?: unknown }): Promise<void> {
    if (typeof payload?.callId !== 'string') return;
    try {
      await this.ring(payload.callId);
    } catch (e) {
      this.logger.warn(`Ringing call ${clean(payload.callId)} failed: ${message(e)}`);
    }
  }

  // The runtime's outcome changes: a call that stops ringing without a dashboard answer closes the banners it opened.
  @OnEvent(AppEvents.CALL.ENDED)
  @OnEvent(AppEvents.CALL.REJECTED)
  @OnEvent(AppEvents.CALL.UPDATED)
  onCallChanged(payload: { callId?: unknown; outcome?: unknown }): void {
    if (typeof payload?.callId !== 'string' || payload.outcome === 'ringing' || payload.outcome === 'answered') return;
    const rung = this.rung.get(payload.callId);
    if (!rung) return;
    this.rung.delete(payload.callId);
    this.gateway.emitToUsers([...rung], 'call:ended', { callId: payload.callId, outcome: payload.outcome });
  }

  @OnEvent(InternalEvents.WS_USER_OFFLINE)
  onUserOffline(payload: WsUserPayload): void {
    this.unavailable.delete(payload.userId); // available again at their next connect
    this.setSocketsLost(payload.userId, true);
  }

  @OnEvent(InternalEvents.WS_USER_ONLINE)
  onUserOnline(payload: WsUserPayload): void {
    this.setSocketsLost(payload.userId, false);
  }

  // The engine's own signals: the caller hung up, or the call stopped ringing while its audio was connecting.
  @OnEvent(InternalEvents.CALL_ENGINE_SIGNAL)
  async onEngineSignal(payload: CallEngineSignalPayload): Promise<void> {
    if (!payload || payload.state === 'ringing') return;
    const session = [...this.sessions.values()].find((s) => s.profileId === payload.profileId && s.waCallId === payload.waCallId);
    if (!session) return;
    if (session.phase === 'connecting') await this.stopConnecting(session, { reRing: false, hangUp: false });
    else await this.end(session, 'caller', 'caller_hangup');
  }

  // The profile's WhatsApp connection went, and its call with it.
  @OnEvent(AppEvents.CONNECTION.DISCONNECTED)
  async onProfileDisconnected(payload: { profileId?: unknown }): Promise<void> {
    for (const s of [...this.sessions.values()]) {
      if (s.profileId !== payload?.profileId) continue;
      if (s.phase === 'connecting') await this.stopConnecting(s, { failure: 'engine_lost', reRing: false });
      else await this.end(s, 'server', 'media_failed', { failure: 'engine_lost' });
    }
  }

  /** Ring the eligible agents of a ringing call nobody claimed: each banner says whether it can be answered here. */
  private async ring(callId: string): Promise<void> {
    // The call's entry exists before the first await: a call that stops ringing meanwhile takes it away (onCallChanged),
    // and this ring then opens no banner, which nothing would close.
    const known = this.rung.get(callId);
    const rung = known ?? new Set<string>();
    if (!known) this.rung.set(callId, rung);
    const closed = () => this.rung.get(callId) !== rung;
    try {
      const found = await findCallForAnswer(callId);
      if (!found || closed()) return;
      const { call, profile } = found;
      if (call.outcome !== 'ringing' || call.answeredByUserId || !profile.organizationId) return;
      // A profile that rejects every call never rings: its calls are gone before anyone could answer them.
      if (profile.settings.callsAnswerInDashboard !== true || profile.settings.autoRejectCalls === true) return;
      const agents = await this.eligibleAgents(profile.organizationId);
      if (!agents.length || closed()) return;
      // This engine is voice-only: the page's bridge carries no video.
      const unavailableReason = call.isGroup ? 'group_call' : call.isVideo ? 'video_call' : (await this.readiness(profile.id, profile.settings)).reasons[0];
      if (closed()) return;
      for (const id of agents) rung.add(id);
      this.gateway.emitToUsers(agents, 'call:ringing', {
        callId,
        profileId: profile.id,
        profileName: profile.displayName ?? profile.id,
        caller: { name: found.callerName, number: callerNumber(call.fromJid) },
        startedAt: call.startedAt.toISOString(),
        answerable: !unavailableReason,
        ...(unavailableReason ? { unavailableReason } : {}),
      });
      this.metric({ kind: 'rung' });
    } finally {
      // An entry this ring made, and rang nobody with, goes.
      if (!known && !closed() && !rung.size) this.rung.delete(callId);
    }
  }

  /** Online users of the organization who may answer, are available and not on a call (roles read fresh). */
  private async eligibleAgents(organizationId: string): Promise<string[]> {
    const online = this.gateway.onlineUserIds();
    if (!online.length) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: online }, organizationId, isActive: true, role: { in: AGENT_ROLES } },
      select: { id: true },
    });
    return users.map((u) => u.id).filter((id) => !this.unavailable.has(id) && !this.busy(id));
  }

  private busy(userId: string): boolean {
    if (this.claiming.has(userId)) return true;
    for (const s of this.sessions.values()) if (s.userId === userId) return true;
    return false;
  }

  private open(call: CallRecord, organizationId: string, userId: string, media: CallMediaEngine): Session {
    let resolve!: (agentProducerId: string) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined); // a session can stop before anything waits on it
    const session: Session = {
      callId: call.id, waCallId: call.waCallId, profileId: call.profileId, organizationId, userId, startedAt: call.startedAt,
      connectDeadline: Date.now() + this.timing.connectMs, media,
      phase: 'connecting', room: null, handle: null, agent: null, agentProducerId: null, agentListening: false,
      ready: { promise, resolve, reject }, answerTried: false, answeredAt: null, answering: null, rejoining: false, socketsLost: false, linkLost: false,
      timers: {},
    };
    session.timers.connect = setTimeout(() => void this.stopConnecting(session, { failure: 'connect_timeout', reRing: true }), this.timing.connectMs);
    this.sessions.set(call.id, session);
    return session;
  }

  /** The room's agent peer, watched: the agent is ready once it has produced its voice AND resumed the caller. */
  private watchedAgent(session: Session, agent: CallMediaSignaling): CallMediaSignaling {
    return {
      ...agent,
      produce: async (transportId, kind, rtpParameters) => {
        const produced = await agent.produce(transportId, kind, rtpParameters);
        session.agentProducerId = produced.id;
        this.agentMaybeReady(session);
        return produced;
      },
      resumeConsumer: async (consumerId) => {
        await agent.resumeConsumer(consumerId);
        session.agentListening = true;
        this.agentMaybeReady(session);
      },
    };
  }

  private agentMaybeReady(session: Session): void {
    if (!session.agentProducerId || !session.agentListening) return;
    if (session.phase === 'connecting') session.ready.resolve(session.agentProducerId);
    else if (session.phase === 'active' && session.rejoining) void this.reconnectAgent(session, session.agentProducerId);
  }

  private async reconnectAgent(session: Session, agentProducerId: string): Promise<void> {
    session.rejoining = false;
    try {
      await withTimeout(session.handle!.connectAgent(agentProducerId), AGENT_CONNECT_MS, 'the agent did not reach the call in time');
      if (session.phase === 'active') this.gateway.emitToUsers([session.userId], 'call:active', { callId: session.callId, answeredAt: session.answeredAt!.toISOString() });
    } catch (e) {
      await this.end(session, 'server', 'media_failed', { failure: 'agent_connect_failed', error: e });
    }
  }

  /**
   * Agent lost: no socket on /ws, or the room's link to the agent down. Either starts the grace; both recovered cancel it.
   * The page's link down for as long ends the call too: the page lets its bridge go 250-500 ms after its call is over, so
   * an end the engine did not report shows here, before the talk-time cap, and the profile's one bridge is freed.
   */
  private watchLinks(session: Session): void {
    const room = session.room!;
    room.onLinkChange((peer, up) => {
      if (peer === 'page') return this.updatePageLink(session, up);
      session.linkLost = !up;
      this.updateGrace(session);
    });
    session.linkLost = !room.linkUp('agent');
    session.socketsLost = !this.gateway.isUserOnline(session.userId);
    this.updateGrace(session);
    this.updatePageLink(session, room.linkUp('page'));
  }

  private updatePageLink(session: Session, up: boolean): void {
    if (session.phase !== 'active') return;
    if (!up && !session.timers.page) {
      session.timers.page = setTimeout(() => void this.end(session, 'server', 'media_failed', { failure: 'engine_lost' }), this.timing.agentGraceMs);
    } else if (up && session.timers.page) {
      clearTimeout(session.timers.page);
      session.timers.page = undefined;
    }
  }

  private setSocketsLost(userId: string, lost: boolean): void {
    for (const s of this.sessions.values()) {
      if (s.userId !== userId) continue;
      s.socketsLost = lost;
      this.updateGrace(s);
    }
  }

  private updateGrace(session: Session): void {
    if (session.phase !== 'active') return;
    const lost = session.socketsLost || session.linkLost;
    if (lost && !session.timers.grace) {
      session.timers.grace = setTimeout(() => void this.end(session, 'server', 'agent_lost'), this.timing.agentGraceMs);
    } else if (!lost && session.timers.grace) {
      clearTimeout(session.timers.grace);
      session.timers.grace = undefined;
    }
  }

  /** The media server's worker died with these rooms: their calls end, or ring again while connecting; admins are told. */
  private async onWorkerDied(callIds: string[]): Promise<void> {
    const cut = callIds.map((id) => this.sessions.get(id)).filter((s): s is Session => !!s);
    const talking = cut.filter((s) => s.phase === 'active').map((s) => s.profileId);
    await Promise.all(
      cut.map((s) =>
        s.phase === 'connecting' ? this.stopConnecting(s, { failure: 'worker_died', reRing: true }) : this.end(s, 'server', 'media_failed', { failure: 'worker_died' }),
      ),
    );
    await this.alerts.workerDied(talking, new Date()).catch((e) => this.logger.warn(`The call media alert failed: ${message(e)}`));
  }

  /**
   * The connecting after the ack: the agent's audio, WhatsApp's Accept, then caller and agent put together. From the
   * Accept on, the session is active: whatever stops it then is an end, which waits for the answer to be stored.
   */
  private async connect(session: Session): Promise<void> {
    let failure: MediaFailure = 'connect_timeout';
    try {
      const agentProducerId = await session.ready.promise;
      if (session.phase !== 'connecting') return;
      failure = 'answer_failed';
      session.answerTried = true;
      try {
        // What is left of the connect budget: the agent's media took the rest.
        await session.media.answer(session.waCallId, { timeoutMs: Math.max(1_000, session.connectDeadline - Date.now()) });
      } finally {
        // Stopped meanwhile, and hung up then: an accept already under way can still connect after that hang-up.
        if (session.phase !== 'connecting') await this.hangUpQuietly(session);
      }
      if (session.phase !== 'connecting') return;
      // WhatsApp holds the call: active now, so whatever stops it from here on is an end.
      clearTimeout(session.timers.connect);
      session.timers.connect = undefined;
      session.answeredAt = new Date();
      session.phase = 'active';
      session.answering = markAnswered(session.callId, session.userId, session.answeredAt).catch((e) => {
        this.logger.warn(`Call ${session.callId}: its answer was not stored: ${message(e)}`);
        return null;
      });
      const answered = await session.answering;
      if (!answered) {
        // The call stopped ringing meanwhile, or the write failed.
        await this.end(session, 'server', 'media_failed', { failure: 'answer_failed', error: new Error('the answer was not stored') });
        return;
      }
      this.rung.delete(session.callId); // the others' banners were told who answered (call:claimed)
      publishCall(this.callDeps(session.profileId), AppEvents.CALL.ANSWERED, answered);
      this.metric({ kind: 'answered', answerSeconds: (session.answeredAt.getTime() - session.startedAt.getTime()) / 1000 });
      this.audit
        .log({ action: 'call.answer', userId: session.userId, organizationId: session.organizationId, resourceType: 'call', resourceId: session.callId, metadata: { profileId: session.profileId } })
        .catch((e) => this.logger.warn(`The audit of the answer of call ${session.callId} failed: ${message(e)}`));
      if (session.phase !== 'active') return; // ended while the answer was stored: that end publishes call.ended
      session.timers.talk = setTimeout(() => void this.end(session, 'server', 'time_limit'), this.timing.maxTalkMs);
      this.watchLinks(session);
      failure = 'attach_failed';
      const pick = await withTimeout(session.handle!.attachCaller(), ATTACH_MS, "the caller's audio did not attach in time");
      if (pick.freshCandidates > 1 || pick.fallback) {
        this.logger.warn(`Call ${session.callId}: the caller's audio is a guess (${clean(pick.freshCandidates)} fresh candidate(s), fallback ${clean(pick.fallback)})`);
      }
      // A rejoin meanwhile took this producer off the call (or replaced it): reconnectAgent connects the new one.
      if (session.phase !== 'active' || session.agentProducerId !== agentProducerId) return;
      failure = 'agent_connect_failed';
      await withTimeout(session.handle!.connectAgent(agentProducerId), AGENT_CONNECT_MS, 'the agent did not reach the call in time');
      if (session.phase !== 'active' || session.agentProducerId !== agentProducerId) return;
      this.gateway.emitToUsers([session.userId], 'call:active', { callId: session.callId, answeredAt: session.answeredAt.toISOString() });
    } catch (e) {
      if (session.phase === 'connecting') await this.stopConnecting(session, { failure, error: e, reRing: true });
      else if (session.phase === 'active') await this.end(session, 'server', 'media_failed', { failure, error: e });
    }
  }

  /**
   * A session that did not get to talk: undo all of it, give the claim back, tell the agent. A call that still rings
   * rings again (`reRing`) for every eligible agent, this one included, unless WhatsApp was asked to answer it: it was
   * hung up then, and rings nowhere. `hangUp: false` for the caller's own end and a shutdown (the engines go with the
   * process); a late accept is still hung up once the answer is over (connect).
   */
  private async stopConnecting(session: Session, opts: { failure?: MediaFailure; error?: unknown; reRing: boolean; hangUp?: boolean }): Promise<void> {
    if (session.phase !== 'connecting') return;
    session.phase = 'ending';
    this.clearTimers(session);
    session.ready.reject(new Error('The session stopped'));
    // WhatsApp's accept cannot be cancelled: it may connect late.
    if (session.answerTried && opts.hangUp !== false) await this.hangUpQuietly(session);
    await this.teardown(session);
    this.sessions.delete(session.callId);
    await releaseClaim(session.callId, session.userId).catch((e) => this.logger.warn(`Call ${session.callId}: its claim was not released: ${message(e)}`));
    this.gateway.emitToUsers([session.userId], 'call:ended', { callId: session.callId, endReason: opts.failure ? 'media_failed' : 'cancelled' });
    if (opts.failure) {
      this.metric({ kind: 'media_failed', reason: opts.failure });
      this.logger.warn(`Call ${session.callId}: the audio did not connect (${opts.failure}${opts.error ? `: ${message(opts.error)}` : ''})`);
    }
    if (opts.reRing && !session.answerTried) await this.ring(session.callId).catch((e) => this.logger.warn(`Ringing call ${session.callId} again failed: ${message(e)}`));
  }

  /** The end of an answered call: hang up what WhatsApp still holds, close the media, store and publish the end. */
  private async end(session: Session, endedBy: CallEndedBy, endReason: CallEndReason, opts: { failure?: MediaFailure; error?: unknown } = {}): Promise<void> {
    const at = new Date();
    if (session.phase !== 'active') return;
    session.phase = 'ending';
    this.clearTimers(session);
    // The caller's own end needs no hang-up, and neither does a shutdown: the engines close with the process.
    if (endedBy !== 'caller' && endReason !== 'server_restart') await this.hangUpQuietly(session);
    await this.teardown(session);
    this.sessions.delete(session.callId);
    // An end while the answer is stored waits for it: its call.ended follows the call.answered, and an answer that did
    // not store leaves a claim to give back.
    const answered = await session.answering;
    let ended: CallRecord | null = null;
    try {
      ended = await markEnded(session.callId, endedBy, endReason, at);
    } catch (e) {
      this.logger.warn(`Call ${session.callId}: its end was not stored: ${message(e)}`);
    }
    if (ended) publishCall(this.callDeps(session.profileId), AppEvents.CALL.ENDED, ended);
    else if (!answered) await releaseClaim(session.callId, session.userId).catch((e) => this.logger.warn(`Call ${session.callId}: its claim was not released: ${message(e)}`));
    this.gateway.emitToUsers([session.userId], 'call:ended', { callId: session.callId, endedBy, endReason, talkSeconds: ended?.talkSeconds ?? null });
    this.metric({ kind: 'ended', endReason });
    if (endReason === 'media_failed') this.metric({ kind: 'media_failed', reason: opts.failure ?? 'engine_lost' });
    if (endReason === 'media_failed' || endReason === 'agent_lost') {
      this.logger.warn(`Call ${session.callId} ended: ${endReason}${opts.failure ? ` (${opts.failure})` : ''}${opts.error ? `: ${message(opts.error)}` : ''}`);
    }
  }

  /** The principal's own session of `callId`, unless it is ending, for an agent (agentOf). */
  private async ownSession(principal: SocketPrincipal, callId: unknown): Promise<{ ok: true; session: Session } | { ok: false; reason: string }> {
    if (!(await this.agentOf(principal))) return { ok: false, reason: 'not_allowed' };
    const session = this.sessionOf(principal, callId);
    return session ? { ok: true, session } : { ok: false, reason: 'not_in_call' };
  }

  /** The session of `callId` that the principal's user answered, unless it is ending: for a dashboard login only. */
  private sessionOf(principal: SocketPrincipal | null, callId: unknown): Session | null {
    const session = typeof callId === 'string' ? this.sessions.get(callId) : undefined;
    if (!principal || principal.apiKeyScopes !== undefined || !session || session.userId !== principal.userId || session.phase === 'ending') return null;
    return session;
  }

  private async hangUpQuietly(session: Session): Promise<void> {
    await withTimeout(session.media.hangUp(session.waCallId), HANGUP_MS).catch((e) => this.logger.warn(`Call ${session.callId}: the hang-up failed: ${message(e)}`));
  }

  /** A session's media, whatever it reached: the page's bridge (one still starting too), then the room. */
  private async teardown(session: Session): Promise<void> {
    await withTimeout(session.media.closeCallMedia(session.waCallId), TEARDOWN_MS).catch(() => undefined);
    session.room?.close();
  }

  private clearTimers(session: Session): void {
    for (const timer of Object.values(session.timers)) if (timer) clearTimeout(timer);
    session.timers = {};
  }

  /** The runtime's publishing (webhooks on the app bus, call:update in realtime) for the coordinator's own changes. */
  private callDeps(profileId: string) {
    return {
      profileId,
      emit: (event: string, payload: Record<string, unknown>) => this.eventEmitter.emit(event, payload),
      emitRealtime: (payload: Record<string, unknown>) => this.realtime.emitCallUpdate(profileId, payload),
      notify: async () => undefined, // a dashboard answer notifies nobody
      logger: this.logger,
    };
  }

  /**
   * The principal as an agent: an active owner, admin or member of its organization (read fresh on every command), on a
   * dashboard login. An API-key socket (an integration) never answers calls: it is not rung, nor counted as online.
   */
  private async agentOf(principal: SocketPrincipal | null): Promise<{ id: string; name: string; organizationId: string } | null> {
    if (!principal || principal.apiKeyScopes !== undefined) return null;
    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, name: true, role: true, isActive: true, organizationId: true },
    });
    if (!user?.isActive || user.organizationId !== principal.organizationId || !AGENT_ROLES.includes(user.role)) return null;
    return { id: user.id, name: user.name, organizationId: user.organizationId };
  }

  /** The counters; they never stop a call. */
  private metric(payload: CallsSessionPayload): void {
    try {
      this.eventEmitter.emit(InternalEvents.CALLS_SESSION, payload);
    } catch {
      // a metrics listener's failure is its own
    }
  }
}

// MultiWA Gateway - the call coordinator: incoming calls answered in the dashboard
// apps/api/src/modules/calls/coordinator/call-session.service.ts
//
// A call of a profile with dashboard answering on rings every eligible agent online: an active owner, admin or member
// of its organization, available, not on a call. The first Answer claims it (calls.answeredByUserId), and its audio
// connects within CALLS_CONNECT_TIMEOUT_MS: a media room, the page's bridge, the agent's transports, and only then
// WhatsApp's own Accept. A claim whose audio does not connect is given back, and the call rings again. An answered call
// ends with the agent's Hang up, the caller's, the talk-time cap, an agent lost for CALLS_AGENT_GRACE_MS, or a media
// failure: every end hangs up what WhatsApp still holds, closes the media, and stores who ended it and why.
// Sessions live in this process, with the engines and the media server they use: a restart ends them, and the next
// boot closes their rows.
import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { AppEvents, REALTIME_EMITTER, type RealtimeEmitter } from '@multiwa/core';
import type { CallMediaEngine, CallMediaHandle, CallMediaSignaling } from '@multiwa/engines';
import { EngineManagerService } from '../../profiles/engine-manager.service';
import { EventsGateway, type SocketPrincipal } from '../../events/events.gateway';
import { AuditService } from '../../audit/audit.service';
import { CallMediaService } from '../media/call-media.service';
import type { CallMediaRoom } from '../media/call-media-room';
import { InternalEvents, type CallsSessionPayload, type WsUserPayload } from '../../../metrics/internal-events';
import { isWorkerEngine } from '../../../common/engine-host';
import { checkReadiness, type CallReadiness } from './call-readiness';
import { CallAlerts } from './call-alerts';
import { findCallForAnswer, reconcileAfterRestart } from './call-session-store';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const message = (e: unknown) => clean((e as Error)?.message ?? e);

/** Who may answer calls: never a viewer. */
const AGENT_ROLES = ['owner', 'admin', 'member'];

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

export function readCallTimings(env: NodeJS.ProcessEnv = process.env): CallTimings {
  return {
    connectMs: positive(env.CALLS_CONNECT_TIMEOUT_MS, 10_000),
    agentGraceMs: positive(env.CALLS_AGENT_GRACE_MS, 15_000),
    maxTalkMs: positive(env.CALLS_MAX_TALK_MINUTES, 120) * 60_000,
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
  media: CallMediaEngine;
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
  /** A reloaded agent page is producing anew (call:rejoin). */
  rejoining: boolean;
  socketsLost: boolean;
  linkLost: boolean;
  timers: { connect?: NodeJS.Timeout; grace?: NodeJS.Timeout; talk?: NodeJS.Timeout };
}

@Injectable()
export class CallSessionService implements OnModuleInit {
  private readonly logger = new Logger(CallSessionService.name);
  private readonly timing = readCallTimings();
  /** The calls being answered (connecting or talking), by calls row id. */
  private readonly sessions = new Map<string, Session>();
  /** The users each ringing call rang: they hear when it is claimed or stops ringing. */
  private readonly rung = new Map<string, Set<string>>();
  /** Users who turned themselves unavailable. They are available again once their last socket goes. */
  private readonly unavailable = new Set<string>();

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
    // Not awaited: a slow calls table must not hold the boot. It runs before the app listens, so before any command.
    reconcileAfterRestart(new Date())
      .then(({ ended, released }) => {
        if (ended.length || released) this.logger.log(`Calls of the previous process: ${ended.length} answered call(s) ended, ${released} claim(s) released`);
      })
      .catch((e) => this.logger.warn(`Call reconciliation failed: ${message(e)}`));
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
  }

  /** Ring the eligible agents of a ringing call nobody claimed: each banner says whether it can be answered here. */
  private async ring(callId: string): Promise<void> {
    const found = await findCallForAnswer(callId);
    if (!found) return;
    const { call, profile } = found;
    if (call.outcome !== 'ringing' || call.answeredByUserId || !profile.organizationId) return;
    // A profile that rejects every call never rings: its calls are gone before anyone could answer them.
    if (profile.settings.callsAnswerInDashboard !== true || profile.settings.autoRejectCalls === true) return;
    const agents = await this.eligibleAgents(profile.organizationId);
    if (!agents.length) return;
    // This engine is voice-only: the page's bridge carries no video.
    const unavailableReason = call.isGroup ? 'group_call' : call.isVideo ? 'video_call' : (await this.readiness(profile.id, profile.settings)).reasons[0];
    const rung = this.rung.get(callId) ?? new Set<string>();
    for (const id of agents) rung.add(id);
    this.rung.set(callId, rung);
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
    for (const s of this.sessions.values()) if (s.userId === userId) return true;
    return false;
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

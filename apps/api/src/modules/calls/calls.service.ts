// MultiWA Gateway - Calls Service
// apps/api/src/modules/calls/calls.service.ts
//
// The REST side of incoming calls: listing, follow-up/assignment, and agent actions
// (reject a ringing call, reply, send a call link). Engine work goes to the engine host:
// the engine manager in this process (ENGINE_HOST=api) or the worker over engine-commands
// (ENGINE_HOST=worker). The host records and publishes what the engine does (call.rejected);
// what the API changes itself (follow-up, assignee) is published here as call.updated.

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import { AppEvents, REALTIME_EMITTER, RealtimeEmitter } from '@multiwa/core';
import {
  CALL_FOLLOW_UPS,
  CALL_OUTCOMES,
  publishCall,
  type CallFollowUp,
  type CallOutcome,
  type CallRecord,
} from '@multiwa/engine-runtime';
import { EngineManagerService } from '../profiles/engine-manager.service';
import { MessagesService } from '../messages/messages.service';
import { EngineCommandsService } from '../engine-commands/engine-commands.service';
import { isWorkerEngine } from '../../common/engine-host';

export interface ListCallsQuery {
  profileId: string;
  outcome?: string;
  followUp?: string;
  from?: string;
  since?: string;
  limit?: number | string;
  cursor?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CALL_INCLUDE = {
  assignedUser: { select: { id: true, name: true } },
  conversation: { select: { id: true, name: true } },
} as const;
// A stuck WhatsApp Web page would otherwise hold the request for puppeteer's 240 s protocol timeout.
const CALL_ACTION_TIMEOUT_MS = 30_000;
const NO_GROUP_ANSWER = 'Group calls cannot be answered from the queue';
const NO_CALL_LINKS = 'Call links are not available on this engine';

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ENGINE_TIMEOUT')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService)) private readonly engineManager: EngineManagerService,
    @Inject(forwardRef(() => MessagesService)) private readonly messages: MessagesService,
    private readonly engineCommands: EngineCommandsService,
    private readonly eventEmitter: EventEmitter2,
    // The Socket.IO gateway in the API, whichever process hosts the engine (the same alias the engine manager injects).
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
  ) {}

  async list(q: ListCallsQuery) {
    if (q.outcome && !CALL_OUTCOMES.includes(q.outcome as CallOutcome)) {
      throw new BadRequestException(`outcome must be one of: ${CALL_OUTCOMES.join(', ')}`);
    }
    if (q.followUp && !CALL_FOLLOW_UPS.includes(q.followUp as CallFollowUp)) {
      throw new BadRequestException(`followUp must be one of: ${CALL_FOLLOW_UPS.join(', ')}`);
    }
    const since = q.since ? new Date(q.since) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new BadRequestException('since must be an ISO date');
    const take = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = await prisma.call.findMany({
      where: {
        profileId: q.profileId,
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.followUp ? { followUp: q.followUp } : {}),
        ...(q.from ? { fromJid: q.from } : {}),
        ...(since ? { startedAt: { gte: since } } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: CALL_INCLUDE,
    });
    const hasMore = rows.length > take;
    const calls = hasMore ? rows.slice(0, take) : rows;
    return { calls, nextCursor: hasMore ? calls[calls.length - 1].id : null };
  }

  async get(id: string) {
    const row = await prisma.call.findUnique({ where: { id }, include: CALL_INCLUDE });
    if (!row) throw new NotFoundException('Call not found');
    return row;
  }

  async update(id: string, dto: { followUp?: string; assignedUserId?: string | null }) {
    const row = await this.get(id);
    const data: { followUp?: string; assignedUserId?: string | null } = {};
    if (dto.followUp !== undefined) {
      if (!CALL_FOLLOW_UPS.includes(dto.followUp as CallFollowUp)) {
        throw new BadRequestException(`followUp must be one of: ${CALL_FOLLOW_UPS.join(', ')}`);
      }
      data.followUp = dto.followUp;
    }
    if (dto.assignedUserId !== undefined) {
      data.assignedUserId = dto.assignedUserId ? await this.assignableUser(row.profileId, dto.assignedUserId) : null;
    }
    if (Object.keys(data).length === 0) return row;
    const updated = await prisma.call.update({ where: { id }, data, include: CALL_INCLUDE });
    this.publishUpdate(updated);
    return updated;
  }

  /** Reject a ringing call. The engine host has the last word on whether it still rings (409 if not) and publishes call.rejected. */
  async reject(id: string) {
    const row = await this.get(id);
    // An early answer for a call that has plainly ended (it never rings again), without a trip to the engine host.
    if (row.outcome !== 'ringing') throw new ConflictException('Call is not ringing any more');
    await this.onEngineHost(() =>
      isWorkerEngine() ? this.engineCommands.rejectCall(row.profileId, row.id) : this.engineManager.rejectCallByAgent(row.profileId, row.id),
    );
    return this.get(id);
  }

  async reply(id: string, text?: string) {
    const row = await this.get(id);
    if (row.isGroup) throw new UnprocessableEntityException(NO_GROUP_ANSWER);
    let body = text?.trim();
    if (!body) {
      const profile = await prisma.profile.findUnique({ where: { id: row.profileId }, select: { settings: true } });
      body = String((profile?.settings as Record<string, unknown> | null)?.callReplyMessage ?? '').trim();
    }
    if (!body) throw new BadRequestException('text is required: this profile has no default call reply');
    // The send-gated path: an incoming call opens the service window, so this is a reply, not a cold send.
    const message = await this.messages.sendText({ profileId: row.profileId, to: row.fromJid, text: body });
    const call = await this.markInProgress(row.id);
    return { call, message };
  }

  async sendCallLink(id: string, type: 'voice' | 'video', text?: string) {
    const row = await this.get(id);
    if (row.isGroup) throw new UnprocessableEntityException(NO_GROUP_ANSWER);
    const link = await this.onEngineHost(() => {
      if (isWorkerEngine()) return this.engineCommands.createCallLink(row.profileId, type);
      const engine = this.engineManager.getEngine(row.profileId);
      if (!engine) throw new Error(`ENGINE_NOT_CONNECTED: profile ${row.profileId} is not connected`);
      return engine.createCallLink(type);
    });
    if (!link) throw new ConflictException(NO_CALL_LINKS); // null = an engine without a call-link API
    const intro = text?.trim();
    const message = await this.messages.sendText({ profileId: row.profileId, to: row.fromJid, text: intro ? `${intro}\n${link}` : link });
    // The send may have waited minutes in the gate, and the runtime writes this row's metadata too
    // (callLogMessageId): merge into what is stored now, not into the copy read at the start.
    const fresh = await this.get(row.id);
    const metadata = (fresh.metadata ?? {}) as Record<string, unknown>;
    const callLinks = Array.isArray(metadata.callLinks) ? metadata.callLinks : [];
    const opens = fresh.followUp === 'open';
    const updated = await prisma.call.update({
      where: { id: row.id },
      data: {
        metadata: { ...metadata, callLinks: [...callLinks, { type, link, at: new Date().toISOString() }] },
        ...(opens ? { followUp: 'in_progress' } : {}),
      },
      include: CALL_INCLUDE,
    });
    if (opens) this.publishUpdate(updated);
    return { call: updated, message, link };
  }

  async openCount(organizationId: string) {
    const count = await prisma.call.count({ where: { followUp: 'open', profile: { workspace: { organizationId } } } });
    return { count };
  }

  private async assignableUser(profileId: string, userId: string): Promise<string> {
    const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { workspace: { select: { organizationId: true } } } });
    const organizationId = profile?.workspace?.organizationId;
    const user = organizationId
      ? await prisma.user.findFirst({ where: { id: userId, organizationId, isActive: true }, select: { id: true } })
      : null;
    if (!user) throw new BadRequestException('assignedUserId must be an active user of this organization');
    return user.id;
  }

  /** Answering a call takes it up: open -> in_progress, judged on the row as it is after the send (the gate may hold it for minutes). */
  private async markInProgress(id: string) {
    const fresh = await this.get(id);
    if (fresh.followUp !== 'open') return fresh;
    const updated = await prisma.call.update({ where: { id }, data: { followUp: 'in_progress' }, include: CALL_INCLUDE });
    this.publishUpdate(updated);
    return updated;
  }

  /** Work on the engine host, bounded in time, its failures told apart as HTTP errors. */
  private async onEngineHost<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(work(), CALL_ACTION_TIMEOUT_MS);
    } catch (e) {
      throw this.mapCallError(e);
    }
  }

  /**
   * call.updated for a change the API made itself, on the app bus (webhooks) and in realtime, like the engine
   * host's own events. The payload has neither `id` nor `messageId` (see toCallPayload). Never throws: the change is stored.
   */
  private publishUpdate(row: CallRecord) {
    publishCall(
      {
        profileId: row.profileId,
        emit: (event, payload) => this.eventEmitter.emit(event, payload),
        emitRealtime: (payload) => this.realtime.emitCallUpdate(row.profileId, payload),
        notify: async () => undefined, // agent actions never notify
        logger: this.logger,
      },
      AppEvents.CALL.UPDATED,
      row,
    );
  }

  /**
   * Engine errors by their code at the start of the message OR by what the message says: with
   * ENGINE_HOST=worker only the message crosses (BullMQ's failedReason), never the error's .code.
   */
  private mapCallError(e: unknown): Error {
    if (e instanceof HttpException) return e;
    const msg = (e as Error)?.message ?? String(e);
    const says = (...needles: string[]) => needles.some((needle) => msg.includes(needle));
    if (says('CALL_NOT_FOUND')) return new NotFoundException('Call not found');
    if (says('CALL_NOT_RINGING', 'not ringing')) return new ConflictException('Call is not ringing any more');
    if (says('ENGINE_NOT_CONNECTED', 'not connected', 'not ready', 'no live engine')) return new ConflictException('Profile is not connected');
    if (says('ENGINE_TIMEOUT', 'timed out')) return new GatewayTimeoutException('WhatsApp did not answer in time');
    if (says('did not return a call link')) return new BadGatewayException('WhatsApp did not return a call link');
    if (says('no call-link API')) return new ConflictException(NO_CALL_LINKS);
    return e as Error; // unknown errors become a plain 500 (Nest does not echo their text)
  }
}

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
  ForbiddenException,
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
  findConversationId,
  publishCall,
  withTimeout,
  type CallFollowUp,
  type CallOutcome,
  type CallRecord,
} from '@multiwa/engine-runtime';
import { EngineManagerService } from '../profiles/engine-manager.service';
import { MessagesService } from '../messages/messages.service';
import { EngineCommandsService } from '../engine-commands/engine-commands.service';
import { isWorkerEngine } from '../../common/engine-host';
import { CALLS_MAX_LIMIT } from './dto';

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
const CALL_INCLUDE = {
  assignedUser: { select: { id: true, name: true } },
  conversation: { select: { id: true, name: true } },
} as const;
// A stuck WhatsApp Web page would otherwise hold the request for puppeteer's 240 s protocol timeout. The engine
// managers give up on an agent's reject first (AGENT_REJECT_TIMEOUT_MS, 25 s), so the runtime lets go of the call before
// this limit in both engine modes: with ENGINE_HOST=worker their timeout comes back as the failure of the command, which
// EngineCommandsService waits for 28 s.
const CALL_ACTION_TIMEOUT_MS = 30_000;
const NO_GROUP_ANSWER = 'Group calls cannot be answered from the queue';
const NO_CALL_LINKS = 'Call links are not available on this engine';

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
    const take = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), CALLS_MAX_LIMIT);
    // The cursor is the last call of the previous page: a call of THIS profile (one of another would give away where that call
    // sits in the order), looked up apart from the filters, which it may have stopped matching (Done on followUp=open).
    const known = q.cursor
      ? await prisma.call.findFirst({ where: { id: q.cursor, profileId: q.profileId }, select: { id: true, startedAt: true } })
      : null;
    if (q.cursor && !known) throw new BadRequestException('Invalid cursor');
    const rows = await prisma.call.findMany({
      where: {
        profileId: q.profileId,
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.followUp ? { followUp: q.followUp } : {}),
        ...(q.from ? { fromJid: q.from } : {}),
        ...(since ? { startedAt: { gte: since } } : {}),
        // Keyset paging: the calls after the cursor in (startedAt, id) order, as the orderBy below sorts them. Not Prisma's `cursor`
        // + `skip: 1`: that starts at the cursor's position but skips one row whether or not the cursor row still matches the
        // filters, so it dropped a real call of the next page. Through AND, so it cannot overwrite `since`.
        ...(known ? { AND: [{ OR: [{ startedAt: { lt: known.startedAt } }, { startedAt: known.startedAt, id: { lt: known.id } }] }] } : {}),
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
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
      if (dto.followUp !== row.followUp) data.followUp = dto.followUp;
    }
    if (dto.assignedUserId !== undefined) {
      const assignee = dto.assignedUserId || null;
      if (assignee !== row.assignedUserId) data.assignedUserId = assignee ? await this.assignableUser(row.profileId, assignee) : null;
    }
    if (Object.keys(data).length === 0) return row; // nothing differs: no write and no call.updated
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
    const message = this.assertSent(await this.messages.sendText({ profileId: row.profileId, to: row.fromJid, text: body }));
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
    const message = this.assertSent(
      await this.messages.sendText({ profileId: row.profileId, to: row.fromJid, text: intro ? `${intro}\n${link}` : link }),
    );
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
        ...(await this.conversationLink(fresh)),
      },
      include: CALL_INCLUDE,
    });
    if (opens) this.publishUpdate(updated);
    return { call: updated, message, link };
  }

  async openCount(organizationId: string) {
    // Prisma reads `organizationId: undefined` as "no filter": without one this would count the calls of every tenant.
    if (!organizationId) throw new ForbiddenException('Missing organization context');
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

  /**
   * MessagesService.sendText does not throw when the engine fails: with ENGINE_HOST=api it RESOLVES
   * { success: false, status: 'failed', error } (an engine error or soft-fail) or { success: true, status: 'pending' }
   * (the profile has no engine); only what the send gate refuses is thrown. A send that did not happen must not be
   * reported as done, so this runs right after the send, before the call is touched or a link remembered.
   * 'queued' (ENGINE_HOST=worker, durable send) is an accepted send: the queue consumer delivers it.
   */
  private assertSent<T extends { success?: boolean; status?: string; error?: string }>(res: T): T {
    if (res.success === false || res.status === 'failed') throw new BadGatewayException(res.error ?? 'The message could not be sent');
    if (res.status === 'pending') throw new ConflictException('Profile is not connected');
    return res;
  }

  /**
   * Answering a call takes it up: open -> in_progress, judged on the row as it is after the send (the gate may hold it for
   * minutes). The same update links the conversation the reply opened, when the call has none. Only the follow-up is announced.
   */
  private async markInProgress(id: string) {
    const fresh = await this.get(id);
    const opens = fresh.followUp === 'open';
    const link = await this.conversationLink(fresh);
    if (!opens && !link.conversationId) return fresh;
    const updated = await prisma.call.update({ where: { id }, data: { ...(opens ? { followUp: 'in_progress' } : {}), ...link }, include: CALL_INCLUDE });
    if (opens) this.publishUpdate(updated);
    return updated;
  }

  /**
   * A call is recorded before the first message to its caller exists, so the row of a first-time caller has no
   * conversation; the message an agent sends opens it. Best effort, never throws: the message is sent by now.
   */
  private async conversationLink(row: { id: string; profileId: string; fromJid: string; conversationId: string | null }): Promise<{ conversationId?: string }> {
    if (row.conversationId) return {};
    try {
      const conversationId = await findConversationId(row.profileId, row.fromJid);
      return conversationId ? { conversationId } : {};
    } catch (e) {
      this.logger.warn(`call ${row.id} was not linked to its conversation: ${(e as Error).message}`);
      return {};
    }
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
    // The patched whatsapp-web.js throws "WhatsApp Web has no call-link API" when the page has neither call-link module.
    if (says('no call-link API')) return new ConflictException(NO_CALL_LINKS);
    return e as Error; // unknown errors become a plain 500 (Nest does not echo their text)
  }
}

// CallsService: the REST side of incoming calls. Listing and follow-up/assignment are database work; reject
// and the call link go to the engine host (the engine manager in this process with ENGINE_HOST=api, the worker
// over engine-commands with ENGINE_HOST=worker, where only the error MESSAGE crosses); replies go through the
// send-gated MessagesService. What the API changes itself is announced as call.updated.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, GatewayTimeoutException, HttpException,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    call: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    conversation: { findFirst: vi.fn() },
    profile: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));
vi.mock('../profiles/profile-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../profiles/profile-settings')>()),
  mergeProfileSettings: vi.fn(),
  mergeProfileSettingsIfAnnounced: vi.fn(),
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { CallsService } from './calls.service';
import { mergeProfileSettings, mergeProfileSettingsIfAnnounced } from '../profiles/profile-settings';

const db = prisma as any;
const START = new Date('2026-10-26T03:00:00.000Z');
const LINK = 'https://call.whatsapp.com/voice/x';
// What MessagesService.sendText really resolves (it does not throw on an engine failure; only the send gate's refusals
// are thrown). `messageId` is the stored message's own id, `waMessageId` WhatsApp's.
const SENT = { success: true, messageId: 'm1', conversationId: 'conv-1', waMessageId: 'wa-m1', status: 'sent' };
const QUEUED = { success: true, messageId: 'm1', conversationId: 'conv-1', status: 'queued' }; // ENGINE_HOST=worker / durable send
const FAILED = { success: false, messageId: 'm1', conversationId: 'conv-1', status: 'failed', error: 'Evaluation failed: boom' };
// A profile with no engine: MessagesService.sendText throws 409 PROFILE_DISCONNECTED (#256).
const notConnected = () =>
  new HttpException({ statusCode: 409, error: 'PROFILE_DISCONNECTED', message: 'Profile is not connected; the message was not sent' }, 409);
const row = (over: Record<string, unknown> = {}): any => ({
  id: 'c1', profileId: 'p1', waCallId: 'wa-1', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'missed', rejectedBy: null, startedAt: START, endedAt: START, followUp: 'open',
  assignedUserId: null, autoReplySentAt: null, conversationId: null, metadata: {}, assignedUser: null, conversation: null, ...over,
});

const STORAGE = { storage: 'local', configured: true, problem: null, lastCheck: null };
function make() {
  const engine = { createCallLink: vi.fn().mockResolvedValue(LINK) };
  const engineManager = { getEngine: vi.fn().mockReturnValue(engine), rejectCallByAgent: vi.fn().mockResolvedValue({ callId: 'c1' }) };
  const messages = { sendText: vi.fn().mockResolvedValue(SENT) };
  const engineCommands = { rejectCall: vi.fn().mockResolvedValue({ callId: 'c1' }), createCallLink: vi.fn().mockResolvedValue(LINK) };
  const eventEmitter = { emit: vi.fn() };
  const realtime = { emitCallUpdate: vi.fn() };
  const sessions = { readiness: vi.fn().mockResolvedValue({ ready: true, reasons: [] }), activeSessionCount: vi.fn(() => 1) };
  const callMedia = { status: vi.fn(() => ({ enabled: true, worker: 'up', port: 40000, activeRooms: 1 })) };
  const recordings = { recordingReasons: vi.fn().mockResolvedValue([]), storageStatus: vi.fn(() => STORAGE) };
  const svc = new CallsService(engineManager as any, messages as any, engineCommands as any, eventEmitter as any, realtime as any, sessions as any, callMedia as any, recordings as any);
  return { svc, engine, engineManager, messages, engineCommands, eventEmitter, realtime, sessions, callMedia, recordings };
}
type Ctx = ReturnType<typeof make>;

// What the service announces when it changes a call itself: ONE call.updated, on the app bus (webhooks) and in
// realtime (Socket.IO), with the same payload. That payload must have neither an `id` nor a `messageId` key:
// the webhook dispatchers name a delivery job after them and BullMQ drops a job whose id exists, so every
// later call.updated of the call would be lost.
function expectAnnounced(t: Ctx, state: Record<string, unknown>) {
  expect(t.eventEmitter.emit).toHaveBeenCalledTimes(1);
  const [event, payload] = t.eventEmitter.emit.mock.calls[0];
  expect(event).toBe(AppEvents.CALL.UPDATED);
  expect(payload).toMatchObject({ callId: 'c1', profileId: 'p1', ...state });
  expect(payload).not.toHaveProperty('id');
  expect(payload).not.toHaveProperty('messageId');
  expect(t.realtime.emitCallUpdate).toHaveBeenCalledTimes(1);
  expect(t.realtime.emitCallUpdate).toHaveBeenCalledWith('p1', payload);
}
function expectNothingAnnounced(t: Ctx) {
  expect(t.eventEmitter.emit).not.toHaveBeenCalled();
  expect(t.realtime.emitCallUpdate).not.toHaveBeenCalled();
}

const MODES = ['api', 'worker'] as const;
type Mode = (typeof MODES)[number];
// Where a reject / call-link request ends up in each mode, and where it must not.
const rejectTarget = (t: Ctx, mode: Mode) => (mode === 'worker' ? t.engineCommands.rejectCall : t.engineManager.rejectCallByAgent);
const rejectBypassed = (t: Ctx, mode: Mode) => (mode === 'worker' ? t.engineManager.rejectCallByAgent : t.engineCommands.rejectCall);
const linkTarget = (t: Ctx, mode: Mode) => (mode === 'worker' ? t.engineCommands.createCallLink : t.engine.createCallLink);

beforeEach(() => {
  for (const m of Object.values(db.call)) (m as any).mockReset();
  db.conversation.findFirst.mockReset();
  for (const m of Object.values(db.profile)) (m as any).mockReset();
  db.user.findFirst.mockReset();
  db.$executeRaw.mockReset().mockResolvedValue(1); // the rows it changed
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('CallsService.list', () => {
  // The position of a cursor call; `after` is what the page must start behind, in (startedAt desc, id desc) order.
  const CURSOR_AT = new Date('2026-10-26T02:00:00.000Z');
  const after = { OR: [{ startedAt: { lt: CURSOR_AT } }, { startedAt: CURSOR_AT, id: { lt: 'z' } }] };

  it('filters, orders newest first and pages with a cursor', async () => {
    db.call.findFirst.mockResolvedValue({ id: 'z', startedAt: CURSOR_AT });
    db.call.findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const { svc } = make();
    const res = await svc.list({ profileId: 'p1', outcome: 'missed', limit: 2, cursor: 'z' });
    expect(db.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', outcome: 'missed', AND: [after] }, take: 3,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }));
    expect(res.calls.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBe('b');
    expect(db.call.findFirst).toHaveBeenCalledWith({ where: { id: 'z', profileId: 'p1' }, select: { id: true, startedAt: true } });
  });

  // "Load more" must not depend on the cursor row still matching the filter: on followUp=open an agent may have marked
  // the last loaded call Done by then. Prisma's `cursor` + `skip: 1` lets the page start at the cursor's position but
  // drops one row regardless of whether the cursor row matches, so a real call of the next page was skipped silently.
  it('pages by keyset, from the position of the cursor call: no Prisma cursor, no skip', async () => {
    db.call.findFirst.mockResolvedValue({ id: 'z', startedAt: CURSOR_AT });
    db.call.findMany.mockResolvedValue([]);
    await make().svc.list({ profileId: 'p1', followUp: 'open', cursor: 'z' });
    const args = db.call.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ profileId: 'p1', followUp: 'open', AND: [after] });
    expect(args).not.toHaveProperty('cursor');
    expect(args).not.toHaveProperty('skip');
  });

  it('keeps `since` and the keyset condition side by side: neither overwrites the other', async () => {
    db.call.findFirst.mockResolvedValue({ id: 'z', startedAt: CURSOR_AT });
    db.call.findMany.mockResolvedValue([]);
    const since = '2026-10-26T00:00:00.000Z';
    await make().svc.list({ profileId: 'p1', since, cursor: 'z' });
    expect(db.call.findMany.mock.calls[0][0].where).toEqual({
      profileId: 'p1', startedAt: { gte: new Date(since) }, AND: [after],
    });
  });

  // A cursor is the id of a call of THIS profile. Its position would otherwise be taken from a call of another profile (or
  // organization), giving away where that call sits in the order.
  it('resolves the cursor within the profile, and answers 400 for one that is not a call of it', async () => {
    db.call.findFirst.mockResolvedValue(null);
    const { svc } = make();
    const err = await svc.list({ profileId: 'p1', cursor: 'a-call-of-another-profile' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Invalid cursor');
    expect(db.call.findFirst).toHaveBeenCalledWith({ where: { id: 'a-call-of-another-profile', profileId: 'p1' }, select: { id: true, startedAt: true } });
    expect(db.call.findMany).not.toHaveBeenCalled();
  });

  it('has no next cursor on the last page, and starts from the top without one', async () => {
    db.call.findMany.mockResolvedValue([row({ id: 'a' })]);
    const res = await make().svc.list({ profileId: 'p1' });
    expect(res).toMatchObject({ calls: [{ id: 'a' }], nextCursor: null });
    const args = db.call.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ where: { profileId: 'p1' }, take: 51 });
    expect(args).not.toHaveProperty('cursor');
    expect(args).not.toHaveProperty('skip');
    expect(db.call.findFirst).not.toHaveBeenCalled(); // nothing to resolve without a cursor
  });

  it('passes follow-up, caller and since on, and keeps the page size within bounds', async () => {
    db.call.findMany.mockResolvedValue([]);
    const { svc } = make();
    await svc.list({ profileId: 'p1', followUp: 'open', from: '628111000111@s.whatsapp.net', since: '2026-10-26T00:00:00.000Z', limit: '9999' });
    expect(db.call.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { profileId: 'p1', followUp: 'open', fromJid: '628111000111@s.whatsapp.net', startedAt: { gte: new Date('2026-10-26T00:00:00.000Z') } },
      take: 101,
    }));
    await svc.list({ profileId: 'p1', limit: 'many' });
    expect(db.call.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 51 }));
    await svc.list({ profileId: 'p1', limit: -4 });
    expect(db.call.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 2 }));
  });

  it('rejects unknown filters', async () => {
    const { svc } = make();
    await expect(svc.list({ profileId: 'p1', outcome: 'bogus' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.list({ profileId: 'p1', followUp: 'later' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.list({ profileId: 'p1', since: 'yesterday' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.call.findMany).not.toHaveBeenCalled();
  });
});

describe('CallsService.get', () => {
  it("returns the call with its assignee, the agent who answered it, its conversation and its recording's facts", async () => {
    db.call.findUnique.mockResolvedValue(row());
    await expect(make().svc.get('c1')).resolves.toMatchObject({ id: 'c1' });
    expect(db.call.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      include: {
        assignedUser: { select: { id: true, name: true } },
        answeredBy: { select: { id: true, name: true } },
        conversation: { select: { id: true, name: true } },
        recording: { select: { id: true, durationSec: true, bytes: true, partial: true, announcementPlayed: true, createdAt: true, deletedAt: true, deleteReason: true } },
      },
    });
  });

  it('404 for a missing call', async () => {
    db.call.findUnique.mockResolvedValue(null);
    await expect(make().svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// Until the call is answered, its answeredByUserId holds a claim: an agent whose audio is still connecting, on a call
// that can still end unanswered. As in the call payloads, a response names the agent of an answered call only.
describe('CallsService: who answered a call', () => {
  const BUDI = { id: 'u2', name: 'Budi' };
  const claimed = (over: Record<string, unknown> = {}) => row({ outcome: 'ringing', answeredByUserId: 'u2', answeredBy: BUDI, ...over });

  it('GET /calls/:id and GET /calls name nobody for a call still being connected, and the agent of an answered call', async () => {
    const { svc } = make();
    db.call.findUnique.mockResolvedValueOnce(claimed()).mockResolvedValueOnce(claimed({ outcome: 'answered' }));
    expect(await svc.get('c1')).toMatchObject({ outcome: 'ringing', answeredByUserId: null, answeredBy: null });
    expect(await svc.get('c1')).toMatchObject({ outcome: 'answered', answeredByUserId: 'u2', answeredBy: BUDI });
    db.call.findMany.mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b', outcome: 'answered' }), claimed({ id: 'c', outcome: 'missed' })]);
    const { calls } = await svc.list({ profileId: 'p1' });
    expect(calls.map((c: any) => [c.id, c.answeredByUserId, c.answeredBy])).toEqual([['a', null, null], ['b', 'u2', BUDI], ['c', null, null]]);
  });

  it.each([
    ['PATCH /calls/:id', (svc: CallsService) => svc.update('c1', { followUp: 'done' })],
    ['POST /calls/:id/reply', (svc: CallsService) => svc.reply('c1', 'x').then((r) => r.call)],
    ['POST /calls/:id/call-link', (svc: CallsService) => svc.sendCallLink('c1', 'voice').then((r) => r.call)],
  ])('%s answers with the call, naming nobody while it is being connected', async (_route, run) => {
    db.call.findUnique.mockResolvedValue(claimed());
    db.call.update.mockResolvedValue(claimed({ followUp: 'in_progress' }));
    expect(await run(make().svc)).toMatchObject({ answeredByUserId: null, answeredBy: null });
  });
});

describe('CallsService.update', () => {
  it('assigns an active user of the same organization and announces call.updated', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.profile.findUnique.mockResolvedValue({ workspace: { organizationId: 'o1' } });
    db.user.findFirst.mockResolvedValue({ id: 'u2' });
    db.call.update.mockResolvedValue(row({ assignedUserId: 'u2' }));
    const t = make();
    await t.svc.update('c1', { assignedUserId: 'u2' });
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u2', organizationId: 'o1', isActive: true }, select: { id: true } });
    expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { assignedUserId: 'u2' } }));
    expectAnnounced(t, { assignedUserId: 'u2' });
  });

  it('changes the follow-up, unassigns with null, and looks nobody up for either', async () => {
    db.call.findUnique.mockResolvedValue(row({ assignedUserId: 'u2' }));
    db.call.update.mockResolvedValue(row({ followUp: 'done', assignedUserId: null }));
    const t = make();
    const res = await t.svc.update('c1', { followUp: 'done', assignedUserId: null });
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { followUp: 'done', assignedUserId: null } }));
    expect(res).toMatchObject({ followUp: 'done', assignedUserId: null });
    expectAnnounced(t, { followUp: 'done', assignedUserId: null });
  });

  it('an update that asks for nothing changes and announces nothing', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    await expect(t.svc.update('c1', {})).resolves.toMatchObject({ id: 'c1' });
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  // A PATCH that asks for what the call already is changes nothing: no write, no call.updated, no lookup of the assignee.
  it.each([
    ['the follow-up it has', { followUp: 'open' }, {}],
    ['the assignee it has', { assignedUserId: 'u2' }, { assignedUserId: 'u2' }],
    ['no assignee when it has none', { assignedUserId: null }, {}],
    ['both', { followUp: 'in_progress', assignedUserId: 'u2' }, { followUp: 'in_progress', assignedUserId: 'u2' }],
  ])('asking for %s writes and announces nothing, and answers with the call as it is', async (_what, dto, stored) => {
    const current = row(stored);
    db.call.findUnique.mockResolvedValue(current);
    const t = make();
    await expect(t.svc.update('c1', dto)).resolves.toBe(current);
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  it('writes only what differs from the call as it is', async () => {
    db.call.findUnique.mockResolvedValue(row({ followUp: 'open' }));
    db.profile.findUnique.mockResolvedValue({ workspace: { organizationId: 'o1' } });
    db.user.findFirst.mockResolvedValue({ id: 'u2' });
    db.call.update.mockResolvedValue(row({ assignedUserId: 'u2' }));
    const t = make();
    await t.svc.update('c1', { followUp: 'open', assignedUserId: 'u2' });
    expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { assignedUserId: 'u2' } }));
    expectAnnounced(t, { assignedUserId: 'u2' });
  });

  it('refuses a user of another organization and an unknown follow-up', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.profile.findUnique.mockResolvedValue({ workspace: { organizationId: 'o1' } });
    db.user.findFirst.mockResolvedValue(null);
    const t = make();
    await expect(t.svc.update('c1', { assignedUserId: 'u9' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.update('c1', { followUp: 'later' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  it('404 for a missing call', async () => {
    db.call.findUnique.mockResolvedValue(null);
    await expect(make().svc.update('nope', { followUp: 'done' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe.each(MODES)('CallsService.reject (ENGINE_HOST=%s)', (mode) => {
  beforeEach(() => {
    vi.stubEnv('ENGINE_HOST', mode);
  });

  it('hands the call to the engine host, and answers with the call as it stands afterwards', async () => {
    db.call.findUnique
      .mockResolvedValueOnce(row({ outcome: 'ringing' }))
      .mockResolvedValueOnce(row({ outcome: 'rejected', rejectedBy: 'agent' }));
    const t = make();
    const res = await t.svc.reject('c1');
    expect(rejectTarget(t, mode)).toHaveBeenCalledWith('p1', 'c1');
    expect(rejectBypassed(t, mode)).not.toHaveBeenCalled();
    expect(res).toMatchObject({ outcome: 'rejected', rejectedBy: 'agent' });
    // The engine host records the reject and publishes call.rejected itself: announcing it here would say it twice.
    expectNothingAnnounced(t);
  });

  it('404 for a missing call, and the engine host is never asked', async () => {
    db.call.findUnique.mockResolvedValue(null);
    const t = make();
    await expect(t.svc.reject('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(t.engineManager.rejectCallByAgent).not.toHaveBeenCalled();
    expect(t.engineCommands.rejectCall).not.toHaveBeenCalled();
  });

  it('409 for a call that no longer rings, without a trip to the engine host', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'missed' }));
    const t = make();
    await expect(t.svc.reject('c1')).rejects.toBeInstanceOf(ConflictException);
    expect(t.engineManager.rejectCallByAgent).not.toHaveBeenCalled();
    expect(t.engineCommands.rejectCall).not.toHaveBeenCalled();
  });

  it.each([
    ['CALL_NOT_RINGING: c1', 409],
    ['CALL_NOT_FOUND: c1', 404],
    ['ENGINE_NOT_CONNECTED: profile p1 is not connected', 409],
    ['Call is not ringing any more', 409],
  ])('%s from the engine host is a %i', async (message, status) => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'ringing' }));
    const t = make();
    rejectTarget(t, mode).mockRejectedValue(new Error(message));
    const err = await t.svc.reject('c1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(status);
  });

  it('lets an error it does not know through as it is (a plain 500)', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'ringing' }));
    const t = make();
    const boom = new Error('boom');
    rejectTarget(t, mode).mockRejectedValue(boom);
    await expect(t.svc.reject('c1')).rejects.toBe(boom);
  });

  it('504 when the engine host does not answer within 30 s', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'ringing' }));
    const t = make();
    rejectTarget(t, mode).mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    let settled = false;
    const pending = expect(t.svc.reject('c1').finally(() => { settled = true; })).rejects.toBeInstanceOf(GatewayTimeoutException);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
  });
});

describe('CallsService.reply', () => {
  it('replies with the profile default and moves open -> in_progress, announcing it', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    db.profile.findUnique.mockResolvedValue({ settings: { callReplyMessage: 'Maaf tadi terlewat' } });
    const t = make();
    const res = await t.svc.reply('c1');
    expect(t.messages.sendText).toHaveBeenCalledWith({ profileId: 'p1', to: '628111000111@s.whatsapp.net', text: 'Maaf tadi terlewat' });
    expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { followUp: 'in_progress' } }));
    expect(res).toMatchObject({ call: { followUp: 'in_progress' }, message: SENT });
    expectAnnounced(t, { followUp: 'in_progress' });
  });

  it('sends the given text (trimmed) instead of the default', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    await t.svc.reply('c1', '  Halo, ada yang bisa dibantu?  ');
    expect(t.messages.sendText).toHaveBeenCalledWith({ profileId: 'p1', to: '628111000111@s.whatsapp.net', text: 'Halo, ada yang bisa dibantu?' });
    expect(db.profile.findUnique).not.toHaveBeenCalled();
  });

  it('leaves a follow-up that is past open alone, and announces nothing', async () => {
    db.call.findUnique.mockResolvedValue(row({ followUp: 'done' }));
    const t = make();
    const res = await t.svc.reply('c1', 'x');
    expect(t.messages.sendText).toHaveBeenCalledTimes(1);
    expect(db.call.update).not.toHaveBeenCalled();
    expect(res.call).toMatchObject({ followUp: 'done' });
    expectNothingAnnounced(t);
  });

  // The send gate may hold a reply for minutes: whether the call is still open is judged after the send.
  it('does not undo a follow-up that was closed while the reply waited in the send gate', async () => {
    db.call.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ followUp: 'done' }));
    const t = make();
    const res = await t.svc.reply('c1', 'x');
    expect(db.call.update).not.toHaveBeenCalled();
    expect(res.call).toMatchObject({ followUp: 'done' });
    expectNothingAnnounced(t);
  });

  it('a reply the send gate refuses leaves the call alone and says nothing', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    const refusal = new HttpException('Daily limit reached', 429);
    t.messages.sendText.mockRejectedValue(refusal);
    await expect(t.svc.reply('c1', 'x')).rejects.toBe(refusal);
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  // MessagesService.sendText does not throw when the engine fails: with ENGINE_HOST=api it RESOLVES
  // { success: false, status: 'failed' } (an engine error or soft-fail). A reply that did not go out must neither take
  // the call up nor be announced.
  it.each([
    ['an engine error', FAILED, 502, 'Evaluation failed: boom'],
    ['a failure that gives no reason', { success: false, messageId: 'm1', status: 'failed' }, 502, 'The message could not be sent'],
    ['a soft failure without a status', { success: false, error: 'Profile not found' }, 502, 'Profile not found'],
  ])('%s is not a reply, and the call is left alone', async (_what, result, status, message) => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    t.messages.sendText.mockResolvedValue(result);
    const err = await t.svc.reply('c1', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(status);
    expect(err.message).toBe(message);
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  it('a profile without an engine is not a reply: its 409 passes through and the call is left alone', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    t.messages.sendText.mockRejectedValue(notConnected());
    const err = await t.svc.reply('c1', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ error: 'PROFILE_DISCONNECTED' });
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  // ENGINE_HOST=worker and DURABLE_SEND answer 'queued': accepted, the queue consumer sends it and owns its retries.
  it('a reply that is only queued is accepted, and takes the call up', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    t.messages.sendText.mockResolvedValue(QUEUED);
    await expect(t.svc.reply('c1', 'x')).resolves.toMatchObject({ call: { followUp: 'in_progress' }, message: QUEUED });
    expectAnnounced(t, { followUp: 'in_progress' });
  });

  it('a listener that fails does not fail a reply that was sent, and is not silent about it', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    const warn = vi.spyOn((t.svc as any).logger, 'warn').mockImplementation(() => undefined);
    t.eventEmitter.emit.mockImplementation(() => { throw new Error('listener blew up'); });
    await expect(t.svc.reply('c1', 'x')).resolves.toMatchObject({ message: SENT });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('listener blew up'));
    expect(t.realtime.emitCallUpdate).toHaveBeenCalledTimes(1);
  });

  // A call is recorded before the first message to its caller exists, so the row of a first-time caller has no
  // conversation. The reply that opens one links it, in the same update that takes the call up.
  describe('links the conversation the reply opened', () => {
    const FROM = '628111000111@s.whatsapp.net';

    it('in the same update as the follow-up', async () => {
      db.call.findUnique.mockResolvedValue(row());
      db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      db.call.update.mockResolvedValue(row({ followUp: 'in_progress', conversationId: 'conv-1' }));
      const t = make();
      await t.svc.reply('c1', 'x');
      expect(db.conversation.findFirst).toHaveBeenCalledWith({ where: { profileId: 'p1', jid: FROM }, select: { id: true } });
      expect(db.call.update).toHaveBeenCalledTimes(1);
      expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' }, data: { followUp: 'in_progress', conversationId: 'conv-1' } }));
      expectAnnounced(t, { followUp: 'in_progress' });
    });

    it('even when the follow-up is already past open, announcing nothing (the payload has no conversation)', async () => {
      db.call.findUnique.mockResolvedValue(row({ followUp: 'done' }));
      db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
      db.call.update.mockResolvedValue(row({ followUp: 'done', conversationId: 'conv-1' }));
      const t = make();
      const res = await t.svc.reply('c1', 'x');
      expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ data: { conversationId: 'conv-1' } }));
      expect(res.call).toMatchObject({ followUp: 'done', conversationId: 'conv-1' });
      expectNothingAnnounced(t);
    });

    it('not for a call that has its conversation already: nothing is looked up', async () => {
      db.call.findUnique.mockResolvedValue(row({ conversationId: 'conv-0' }));
      db.call.update.mockResolvedValue(row({ followUp: 'in_progress', conversationId: 'conv-0' }));
      await make().svc.reply('c1', 'x');
      expect(db.conversation.findFirst).not.toHaveBeenCalled();
      expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ data: { followUp: 'in_progress' } }));
    });

    it('and leaves the link unset when there is no conversation', async () => {
      db.call.findUnique.mockResolvedValue(row());
      db.conversation.findFirst.mockResolvedValue(null);
      db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
      await make().svc.reply('c1', 'x');
      expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ data: { followUp: 'in_progress' } }));
    });

    it('a lookup that fails does not fail a reply that was sent, and is not silent about it', async () => {
      db.call.findUnique.mockResolvedValue(row());
      db.conversation.findFirst.mockRejectedValue(new Error('db blip'));
      db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
      const t = make();
      const warn = vi.spyOn((t.svc as any).logger, 'warn').mockImplementation(() => undefined);
      await expect(t.svc.reply('c1', 'x')).resolves.toMatchObject({ call: { followUp: 'in_progress' }, message: SENT });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('db blip'));
      expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({ data: { followUp: 'in_progress' } }));
    });

    it('a reply that was not sent links nothing', async () => {
      db.call.findUnique.mockResolvedValue(row());
      const t = make();
      t.messages.sendText.mockResolvedValue(FAILED);
      await expect(t.svc.reply('c1', 'x')).rejects.toBeInstanceOf(BadGatewayException);
      expect(db.conversation.findFirst).not.toHaveBeenCalled();
      expect(db.call.update).not.toHaveBeenCalled();
    });
  });

  it('refuses group calls and an empty reply, sending nothing', async () => {
    db.call.findUnique.mockResolvedValue(row({ isGroup: true }));
    const group = make();
    await expect(group.svc.reply('c1', 'x')).rejects.toBeInstanceOf(UnprocessableEntityException);
    db.call.findUnique.mockResolvedValue(row());
    db.profile.findUnique.mockResolvedValue({ settings: {} });
    const empty = make();
    await expect(empty.svc.reply('c1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(empty.svc.reply('c1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(group.messages.sendText).not.toHaveBeenCalled();
    expect(empty.messages.sendText).not.toHaveBeenCalled();
  });

  it('404 for a missing call', async () => {
    db.call.findUnique.mockResolvedValue(null);
    await expect(make().svc.reply('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe.each(MODES)('CallsService.sendCallLink (ENGINE_HOST=%s)', (mode) => {
  beforeEach(() => {
    vi.stubEnv('ENGINE_HOST', mode);
  });

  // api: the profile's live engine; worker: the worker's engine over engine-commands (which carries the profile id).
  const expectRequested = (t: Ctx, type: string) => {
    if (mode === 'worker') {
      expect(t.engineCommands.createCallLink).toHaveBeenCalledWith('p1', type);
      expect(t.engineManager.getEngine).not.toHaveBeenCalled();
    } else {
      expect(t.engineManager.getEngine).toHaveBeenCalledWith('p1');
      expect(t.engine.createCallLink).toHaveBeenCalledWith(type);
      expect(t.engineCommands.createCallLink).not.toHaveBeenCalled();
    }
  };

  it('creates a call link, sends it with the text, remembers it and announces the follow-up', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    const res = await t.svc.sendCallLink('c1', 'voice', 'Silakan gabung');
    expectRequested(t, 'voice');
    expect(t.messages.sendText).toHaveBeenCalledWith({ profileId: 'p1', to: '628111000111@s.whatsapp.net', text: `Silakan gabung\n${LINK}` });
    expect(db.call.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      data: { followUp: 'in_progress', metadata: { callLinks: [{ type: 'voice', link: LINK, at: expect.any(String) }] } },
    }));
    expect(res.link).toBe(LINK);
    expect(res).toMatchObject({ call: { followUp: 'in_progress' }, message: SENT });
    expectAnnounced(t, { followUp: 'in_progress' });
  });

  it('sends the bare link when there is no text', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    await t.svc.sendCallLink('c1', 'video', '   ');
    expectRequested(t, 'video');
    expect(t.messages.sendText).toHaveBeenCalledWith({ profileId: 'p1', to: '628111000111@s.whatsapp.net', text: LINK });
  });

  // The send can wait minutes in the gate, and the runtime writes this row's metadata too (callLogMessageId):
  // the link is merged into what is stored right before the write, never into the copy read at the start.
  it('merges the link into the metadata as it is now, keeping what the runtime attached meanwhile', async () => {
    const earlier = { type: 'voice', link: 'https://call.whatsapp.com/voice/old', at: '2026-10-26T03:05:00.000Z' };
    db.call.findUnique
      .mockResolvedValueOnce(row({ metadata: { lidJid: '1234567@lid' } }))
      .mockResolvedValueOnce(row({ metadata: { lidJid: '1234567@lid', callLogMessageId: 'log-1', callLinks: [earlier] } }));
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    await t.svc.sendCallLink('c1', 'video');
    const data = db.call.update.mock.calls[0][0].data;
    expect(data.metadata).toEqual({
      lidJid: '1234567@lid',
      callLogMessageId: 'log-1',
      callLinks: [earlier, { type: 'video', link: LINK, at: expect.any(String) }],
    });
  });

  it('remembers the link without announcing anything when the follow-up is already past open', async () => {
    db.call.findUnique.mockResolvedValue(row({ followUp: 'in_progress' }));
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    await t.svc.sendCallLink('c1', 'voice');
    const arg = db.call.update.mock.calls[0][0];
    expect(arg.data).toEqual({ metadata: { callLinks: [{ type: 'voice', link: LINK, at: expect.any(String) }] } });
    expectNothingAnnounced(t);
  });

  it('links the conversation the message opened, in the same update that remembers the link', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress', conversationId: 'conv-1' }));
    const t = make();
    await t.svc.sendCallLink('c1', 'voice');
    expect(db.conversation.findFirst).toHaveBeenCalledWith({ where: { profileId: 'p1', jid: '628111000111@s.whatsapp.net' }, select: { id: true } });
    expect(db.call.update).toHaveBeenCalledTimes(1);
    expect(db.call.update.mock.calls[0][0].data).toMatchObject({ followUp: 'in_progress', conversationId: 'conv-1' });
  });

  it('does not look the conversation up when the call has it, and does not fail when the lookup fails', async () => {
    db.call.findUnique.mockResolvedValue(row({ conversationId: 'conv-0' }));
    db.call.update.mockResolvedValue(row({ conversationId: 'conv-0' }));
    await make().svc.sendCallLink('c1', 'voice');
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
    expect(db.call.update.mock.calls[0][0].data).not.toHaveProperty('conversationId');

    db.call.findUnique.mockResolvedValue(row());
    db.conversation.findFirst.mockRejectedValue(new Error('db blip'));
    const t = make();
    const warn = vi.spyOn((t.svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(t.svc.sendCallLink('c1', 'voice')).resolves.toMatchObject({ link: LINK });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db blip'));
    expect(db.call.update.mock.calls[1][0].data).not.toHaveProperty('conversationId');
  });

  it('does not undo a follow-up that was closed while the link waited in the send gate', async () => {
    db.call.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ followUp: 'done' }));
    db.call.update.mockResolvedValue(row({ followUp: 'done' }));
    const t = make();
    await t.svc.sendCallLink('c1', 'voice');
    expect(db.call.update.mock.calls[0][0].data).not.toHaveProperty('followUp');
    expectNothingAnnounced(t);
  });

  it('409 when the engine cannot create call links (it answers null), sending nothing', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    linkTarget(t, mode).mockResolvedValue(null);
    const err = await t.svc.sendCallLink('c1', 'voice').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Call links are not available on this engine');
    expect(t.messages.sendText).not.toHaveBeenCalled();
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it.each([
    ['Client not ready', 409],
    ['Profile p1 not connected', 409],
    ['WhatsApp did not return a call link', 502],
    ['Creating the call link timed out', 504],
    ['WhatsApp Web has no call-link API', 409],
  ])('engine failure "%s" is a %i, sending nothing', async (message, status) => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    linkTarget(t, mode).mockRejectedValueOnce(new Error(message));
    const err = await t.svc.sendCallLink('c1', 'voice').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(status);
    expect(t.messages.sendText).not.toHaveBeenCalled();
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it('504 when the engine host does not answer within 30 s, sending nothing', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    linkTarget(t, mode).mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers();
    const pending = expect(t.svc.sendCallLink('c1', 'voice')).rejects.toBeInstanceOf(GatewayTimeoutException);
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(t.messages.sendText).not.toHaveBeenCalled();
  });

  it('a link the send gate refuses is not remembered', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    const refusal = new HttpException('Daily limit reached', 429);
    t.messages.sendText.mockRejectedValue(refusal);
    await expect(t.svc.sendCallLink('c1', 'voice')).rejects.toBe(refusal);
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  // The link was created, but the message that carries it did not go out: it must not be remembered as sent.
  it.each([
    ['an engine error', FAILED, 502, 'Evaluation failed: boom'],
    ['a failure that gives no reason', { success: false, messageId: 'm1', status: 'failed' }, 502, 'The message could not be sent'],
  ])('a link whose message failed (%s) is not remembered, and the call is left alone', async (_what, result, status, message) => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    t.messages.sendText.mockResolvedValue(result);
    const err = await t.svc.sendCallLink('c1', 'voice').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(status);
    expect(err.message).toBe(message);
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  it('a link to a profile without an engine is not remembered: its 409 passes through and the call is left alone', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    t.messages.sendText.mockRejectedValue(notConnected());
    const err = await t.svc.sendCallLink('c1', 'voice').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ error: 'PROFILE_DISCONNECTED' });
    expect(db.call.update).not.toHaveBeenCalled();
    expectNothingAnnounced(t);
  });

  it('a link that is only queued is accepted, remembered, and takes the call up', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    t.messages.sendText.mockResolvedValue(QUEUED);
    await expect(t.svc.sendCallLink('c1', 'voice')).resolves.toMatchObject({ link: LINK, message: QUEUED });
    expect(db.call.update.mock.calls[0][0].data.metadata.callLinks).toHaveLength(1);
    expectAnnounced(t, { followUp: 'in_progress' });
  });

  it('refuses group calls without asking the engine', async () => {
    db.call.findUnique.mockResolvedValue(row({ isGroup: true }));
    const t = make();
    await expect(t.svc.sendCallLink('c1', 'voice')).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(t.engineCommands.createCallLink).not.toHaveBeenCalled();
    expect(t.engineManager.getEngine).not.toHaveBeenCalled();
  });

  it('404 for a missing call', async () => {
    db.call.findUnique.mockResolvedValue(null);
    await expect(make().svc.sendCallLink('nope', 'voice')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CallsService.sendCallLink without a live engine (ENGINE_HOST=api)', () => {
  it('409: the profile is not connected', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const t = make();
    t.engineManager.getEngine.mockReturnValue(null);
    await expect(t.svc.sendCallLink('c1', 'voice')).rejects.toBeInstanceOf(ConflictException);
    expect(t.messages.sendText).not.toHaveBeenCalled();
  });
});

// The worker hands over messages only (BullMQ's failedReason, no .code), so errors are told apart by the code at
// the start of the message OR by what the message says.
describe('CallsService.mapCallError', () => {
  const map = (e: unknown): any => (make().svc as any).mapCallError(e);

  it.each([
    ['CALL_NOT_FOUND: c1', 404, 'Call not found'],
    ['CALL_NOT_RINGING: c1', 409, 'Call is not ringing any more'],
    ['Call is not ringing any more', 409, 'Call is not ringing any more'],
    ['ENGINE_NOT_CONNECTED: profile p1 is not connected', 409, 'Profile is not connected'],
    ['Profile p1 not connected', 409, 'Profile is not connected'],
    ['Client not ready', 409, 'Profile is not connected'],
    ['no live engine for profile p1', 409, 'Profile is not connected'],
    ['ENGINE_TIMEOUT', 504, 'WhatsApp did not answer in time'],
    ['Creating the call link timed out', 504, 'WhatsApp did not answer in time'],
    ['Job wait create-call-link timed out before finishing, no finish notification arrived after 28000ms (id=create-call-link-p1-1793098112905-3b241101-e2bb-4255-8caf-4136c566a962)', 504, 'WhatsApp did not answer in time'],
    ['WhatsApp did not return a call link', 502, 'WhatsApp did not return a call link'],
    ['WhatsApp Web has no call-link API', 409, 'Call links are not available on this engine'],
  ])('%s -> %i', (message, status, text) => {
    const mapped = map(new Error(message));
    expect(mapped).toBeInstanceOf(HttpException);
    expect(mapped.getStatus()).toBe(status);
    expect(mapped.message).toBe(text);
  });

  it('maps to the matching exception classes', () => {
    expect(map(new Error('CALL_NOT_FOUND: c1'))).toBeInstanceOf(NotFoundException);
    expect(map(new Error('CALL_NOT_RINGING: c1'))).toBeInstanceOf(ConflictException);
    expect(map(new Error('ENGINE_TIMEOUT'))).toBeInstanceOf(GatewayTimeoutException);
    expect(map(new Error('WhatsApp did not return a call link'))).toBeInstanceOf(BadGatewayException);
  });

  it('keeps an HTTP error as it is, whatever it says', () => {
    const unavailable = new ServiceUnavailableException('Engine command client not ready (ENGINE_HOST must be "worker")');
    expect(map(unavailable)).toBe(unavailable);
  });

  it('hands back anything else unchanged, for Nest to answer with a 500', () => {
    const boom = new Error('boom');
    expect(map(boom)).toBe(boom);
    expect(map('weird')).toBe('weird');
    expect(map(undefined)).toBeUndefined();
  });
});

describe('CallsService.openCount', () => {
  it('counts open follow-ups of the organization', async () => {
    db.call.count.mockResolvedValue(4);
    await expect(make().svc.openCount('o1')).resolves.toEqual({ count: 4 });
    expect(db.call.count).toHaveBeenCalledWith({ where: { followUp: 'open', profile: { workspace: { organizationId: 'o1' } } } });
  });

  // Prisma reads `organizationId: undefined` as "no filter": without an organization it would count every tenant's calls.
  it.each([undefined, null, ''])('is forbidden without an organization (%j), and counts nothing', async (organizationId) => {
    await expect(make().svc.openCount(organizationId as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.call.count).not.toHaveBeenCalled();
  });
});

describe('CallsService: call settings and status', () => {
  const merge = vi.mocked(mergeProfileSettings);
  const mergeIfAnnounced = vi.mocked(mergeProfileSettingsIfAnnounced);
  const ANNOUNCEMENT = { storageKey: 'announcements/o/p/a.mp3', mimeType: 'audio/mpeg', durationSec: 4 };
  beforeEach(() => {
    merge.mockReset().mockImplementation(async (_id, patch) => ({ quietAlarmHours: 2, ...patch }));
    mergeIfAnnounced.mockReset().mockImplementation(async (_id, patch) => ({ callsAnnouncement: ANNOUNCEMENT, ...patch }));
    db.profile.findUnique.mockReset().mockResolvedValue({ settings: { autoRejectCalls: false, quietAlarmHours: 2 } });
  });

  it('turning answering on needs a ready profile: 409 with the reasons, nothing written', async () => {
    const { svc, sessions } = make();
    sessions.readiness.mockResolvedValueOnce({ ready: false, reasons: ['media_disabled', 'profile_not_connected'] });
    await expect(svc.updateCallSettings('p1', { answerInDashboard: true })).rejects.toMatchObject({
      status: 409,
      response: { message: 'Answering calls in the dashboard is not available for this profile', reasons: ['media_disabled', 'profile_not_connected'] },
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('turning recording on needs an announcement and a private storage: 409 with the reasons, nothing written', async () => {
    const { svc, recordings } = make();
    recordings.recordingReasons.mockResolvedValueOnce(['no_announcement', 'storage_not_private']);
    await expect(svc.updateCallSettings('p1', { recording: true })).rejects.toMatchObject({
      status: 409,
      response: { message: 'Recording calls is not available for this profile', reasons: ['no_announcement', 'storage_not_private'] },
    });
    expect(recordings.recordingReasons).toHaveBeenCalledWith('p1', { autoRejectCalls: false, quietAlarmHours: 2 });
    expect(mergeIfAnnounced).not.toHaveBeenCalled();
  });

  it('both refused at once: every reason in one 409', async () => {
    const { svc, sessions, recordings } = make();
    sessions.readiness.mockResolvedValueOnce({ ready: false, reasons: ['media_disabled'] });
    recordings.recordingReasons.mockResolvedValueOnce(['no_announcement']);
    await expect(svc.updateCallSettings('p1', { answerInDashboard: true, recording: true })).rejects.toMatchObject({
      response: { message: 'Answering calls in the dashboard and recording them are not available for this profile', reasons: ['media_disabled', 'no_announcement'] },
    });
  });

  // The checks can take seconds (the page probe, the storage check), and other routes write the settings JSON too:
  // only the keys given are merged, in one statement, and the answer is the settings as written.
  it('writes only the keys it was given, and answers with the settings as written', async () => {
    const { svc, sessions, recordings } = make();
    expect(await svc.updateCallSettings('p1', { answerInDashboard: false, retentionDays: 30 })).toEqual({
      profileId: 'p1', answerInDashboard: false, recording: false, retentionDays: 30, announcement: null,
    });
    expect(merge).toHaveBeenCalledWith('p1', { callsAnswerInDashboard: false, callsRecordingRetentionDays: 30 });
    expect(sessions.readiness).not.toHaveBeenCalled(); // off needs no readiness
    expect(recordings.recordingReasons).not.toHaveBeenCalled();
  });

  it('turning recording on writes only while the announcement is still there', async () => {
    const { svc } = make();
    expect(await svc.updateCallSettings('p1', { recording: true })).toEqual({
      profileId: 'p1', answerInDashboard: false, recording: true, retentionDays: 90, announcement: { mimeType: 'audio/mpeg', durationSec: 4 },
    });
    expect(mergeIfAnnounced).toHaveBeenCalledWith('p1', { callsRecording: true });
    expect(merge).not.toHaveBeenCalled();
  });

  it('409 no_announcement when the announcement was removed between the check and the write', async () => {
    const { svc } = make();
    mergeIfAnnounced.mockResolvedValueOnce(null);
    await expect(svc.updateCallSettings('p1', { recording: true })).rejects.toMatchObject({ status: 409, response: { reasons: ['no_announcement'] } });
  });

  // The conditional write gives null for both: the profile is looked up again to tell them apart.
  it('404, not 409, when the profile was deleted between the check and the write of recording on', async () => {
    const { svc } = make();
    mergeIfAnnounced.mockResolvedValueOnce(null);
    db.profile.findUnique.mockResolvedValueOnce({ settings: {} }).mockResolvedValueOnce(null);
    await expect(svc.updateCallSettings('p1', { recording: true })).rejects.toMatchObject({ status: 404 });
    expect(mergeIfAnnounced).toHaveBeenCalledWith('p1', { callsRecording: true });
  });

  // A form that always sends every field would re-run the check of a value already on, and while that check fails for a
  // while (the storage check, a phone offline) nothing else could change. Nothing is written for it either, so a value
  // the nightly privacy check turned off (false then) never comes back on this way.
  it('a stored true sent again is left as it is: neither checked nor written, and the rest is written', async () => {
    const { svc, sessions, recordings } = make();
    const stored = { callsAnswerInDashboard: true, callsRecording: true, callsAnnouncement: ANNOUNCEMENT };
    db.profile.findUnique.mockReset().mockResolvedValue({ settings: stored });
    merge.mockImplementation(async (_id, patch) => ({ ...stored, ...patch }));
    sessions.readiness.mockResolvedValue({ ready: false, reasons: ['profile_not_connected'] });
    recordings.recordingReasons.mockResolvedValue(['storage_check_failed']);
    expect(await svc.updateCallSettings('p1', { answerInDashboard: true, recording: true, retentionDays: 30 })).toEqual({
      profileId: 'p1', answerInDashboard: true, recording: true, retentionDays: 30, announcement: { mimeType: 'audio/mpeg', durationSec: 4 },
    });
    expect(merge).toHaveBeenCalledWith('p1', { callsRecordingRetentionDays: 30 });
    expect(mergeIfAnnounced).not.toHaveBeenCalled();
    expect(sessions.readiness).not.toHaveBeenCalled();
    expect(recordings.recordingReasons).not.toHaveBeenCalled();
  });

  it('turning recording off needs no check', async () => {
    const { svc, recordings } = make();
    await svc.updateCallSettings('p1', { recording: false });
    expect(recordings.recordingReasons).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith('p1', { callsRecording: false });
  });

  it('400 when nothing is given', async () => {
    await expect(make().svc.updateCallSettings('p1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(db.profile.findUnique).not.toHaveBeenCalled();
  });

  it('an unknown profile is 404, also one deleted while it was checked', async () => {
    const { svc } = make();
    db.profile.findUnique.mockResolvedValueOnce(null);
    await expect(svc.updateCallSettings('nope', { answerInDashboard: false })).rejects.toMatchObject({ status: 404 });
    merge.mockResolvedValueOnce(null);
    db.profile.findUnique.mockResolvedValueOnce({ settings: {} }).mockResolvedValueOnce(null);
    await expect(svc.updateCallSettings('p1', { answerInDashboard: true })).rejects.toMatchObject({ status: 404 });
  });

  // The media server and the recordings storage serve every organization: their rooms and files are not shown, and the
  // sessions in progress are the organization's own.
  it("status: the media server's, the recordings storage's, and each profile with its call settings and readiness", async () => {
    const { svc, sessions } = make();
    db.profile.findMany.mockResolvedValue([
      { id: 'p1', displayName: 'Line 1', settings: { callsAnswerInDashboard: true, callsRecording: true, callsRecordingRetentionDays: 30, callsAnnouncement: ANNOUNCEMENT } },
      { id: 'p2', displayName: null, settings: {} },
    ]);
    expect(await svc.mediaStatus('o1')).toEqual({
      server: { enabled: true, worker: 'up', port: 40000, engineHost: 'api', activeSessions: 1, recordings: STORAGE },
      profiles: [
        { profileId: 'p1', name: 'Line 1', answerInDashboard: true, recording: true, retentionDays: 30, announcement: { mimeType: 'audio/mpeg', durationSec: 4 }, ready: true, reasons: [] },
        { profileId: 'p2', name: 'p2', answerInDashboard: false, recording: false, retentionDays: 90, announcement: null, ready: true, reasons: [] },
      ],
    });
    expect(sessions.activeSessionCount).toHaveBeenCalledWith('o1');
    expect(db.profile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace: { organizationId: 'o1' } } }));
  });

  // As for openCount: without an organization the profile query would list every tenant's profiles.
  it.each([undefined, null, ''])('status is forbidden without an organization (%j), and lists nothing', async (organizationId) => {
    await expect(make().svc.mediaStatus(organizationId as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.profile.findMany).not.toHaveBeenCalled();
  });
});

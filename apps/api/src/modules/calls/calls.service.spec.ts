// CallsService: the REST side of incoming calls. Listing and follow-up/assignment are database work; reject
// and the call link go to the engine host (the engine manager in this process with ENGINE_HOST=api, the worker
// over engine-commands with ENGINE_HOST=worker, where only the error MESSAGE crosses); replies go through the
// send-gated MessagesService. What the API changes itself is announced as call.updated.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadGatewayException, BadRequestException, ConflictException, GatewayTimeoutException, HttpException,
  NotFoundException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    call: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    profile: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { CallsService } from './calls.service';

const db = prisma as any;
const START = new Date('2026-10-26T03:00:00.000Z');
const LINK = 'https://call.whatsapp.com/voice/x';
const row = (over: Record<string, unknown> = {}): any => ({
  id: 'c1', profileId: 'p1', waCallId: 'wa-1', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'missed', rejectedBy: null, startedAt: START, endedAt: START, followUp: 'open',
  assignedUserId: null, autoReplySentAt: null, conversationId: null, metadata: {}, assignedUser: null, conversation: null, ...over,
});

function make() {
  const engine = { createCallLink: vi.fn().mockResolvedValue(LINK) };
  const engineManager = { getEngine: vi.fn().mockReturnValue(engine), rejectCallByAgent: vi.fn().mockResolvedValue({ callId: 'c1' }) };
  const messages = { sendText: vi.fn().mockResolvedValue({ id: 'm1' }) };
  const engineCommands = { rejectCall: vi.fn().mockResolvedValue({ callId: 'c1' }), createCallLink: vi.fn().mockResolvedValue(LINK) };
  const eventEmitter = { emit: vi.fn() };
  const realtime = { emitCallUpdate: vi.fn() };
  const svc = new CallsService(engineManager as any, messages as any, engineCommands as any, eventEmitter as any, realtime as any);
  return { svc, engine, engineManager, messages, engineCommands, eventEmitter, realtime };
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
  db.profile.findUnique.mockReset();
  db.user.findFirst.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('CallsService.list', () => {
  it('filters, orders newest first and pages with a cursor', async () => {
    db.call.findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const { svc } = make();
    const res = await svc.list({ profileId: 'p1', outcome: 'missed', limit: 2, cursor: 'z' });
    expect(db.call.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', outcome: 'missed' }, take: 3, cursor: { id: 'z' }, skip: 1,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }));
    expect(res.calls.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(res.nextCursor).toBe('b');
  });

  it('has no next cursor on the last page, and starts from the top without one', async () => {
    db.call.findMany.mockResolvedValue([row({ id: 'a' })]);
    const res = await make().svc.list({ profileId: 'p1' });
    expect(res).toMatchObject({ calls: [{ id: 'a' }], nextCursor: null });
    const args = db.call.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ where: { profileId: 'p1' }, take: 51 });
    expect(args).not.toHaveProperty('cursor');
    expect(args).not.toHaveProperty('skip');
  });

  it('passes follow-up, caller and since on, and keeps the page size within bounds', async () => {
    db.call.findMany.mockResolvedValue([]);
    const { svc } = make();
    await svc.list({ profileId: 'p1', followUp: 'open', from: '628111000111@s.whatsapp.net', since: '2026-10-26T00:00:00.000Z', limit: '9999' });
    expect(db.call.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { profileId: 'p1', followUp: 'open', fromJid: '628111000111@s.whatsapp.net', startedAt: { gte: new Date('2026-10-26T00:00:00.000Z') } },
      take: 201,
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
  it('returns the call with its assignee and conversation', async () => {
    db.call.findUnique.mockResolvedValue(row());
    await expect(make().svc.get('c1')).resolves.toMatchObject({ id: 'c1' });
    expect(db.call.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      include: { assignedUser: { select: { id: true, name: true } }, conversation: { select: { id: true, name: true } } },
    });
  });

  it('404 for a missing call', async () => {
    db.call.findUnique.mockResolvedValue(null);
    await expect(make().svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
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
    expect(res).toMatchObject({ call: { followUp: 'in_progress' }, message: { id: 'm1' } });
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

  it('a listener that fails does not fail a reply that was sent, and is not silent about it', async () => {
    db.call.findUnique.mockResolvedValue(row());
    db.call.update.mockResolvedValue(row({ followUp: 'in_progress' }));
    const t = make();
    const warn = vi.spyOn((t.svc as any).logger, 'warn').mockImplementation(() => undefined);
    t.eventEmitter.emit.mockImplementation(() => { throw new Error('listener blew up'); });
    await expect(t.svc.reply('c1', 'x')).resolves.toMatchObject({ message: { id: 'm1' } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('listener blew up'));
    expect(t.realtime.emitCallUpdate).toHaveBeenCalledTimes(1);
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
    expect(res).toMatchObject({ call: { followUp: 'in_progress' }, message: { id: 'm1' } });
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
    ['Job wait create-call-link timed out before finishing, no finish notification arrived after 20000ms (id=create-call-link-p1-1)', 504, 'WhatsApp did not answer in time'],
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
});

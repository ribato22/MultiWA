// The calls runtime (packages/engine-runtime/src/calls.ts): engine signals and
// call-log messages become `calls` rows plus call.* events. Prisma is mocked.
//
// notifyMissed throttles per profile and caller for 10 minutes, per process and with the
// clock frozen at NOW. A test that asserts a notification therefore uses a caller of its own.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    call: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { handleEngineCall, handleCallLog, closeStaleRingingCalls, rejectCallByAgent, toCallPayload } from '@multiwa/engine-runtime';

const NOW = new Date('2026-10-26T03:00:00.000Z');
const db = prisma as any;

function row(over: Record<string, unknown> = {}): any {
  return {
    id: 'row-1', profileId: 'p1', waCallId: 'wa-1', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
    direction: 'incoming', outcome: 'ringing', rejectedBy: null, startedAt: NOW, endedAt: null, followUp: 'open',
    assignedUserId: null, autoReplySentAt: null, conversationId: null, ...over,
  };
}

function deps(over: Record<string, unknown> = {}): any {
  return {
    profileId: 'p1', settings: {}, emit: vi.fn(), emitRealtime: vi.fn(), notify: vi.fn().mockResolvedValue(undefined),
    rejectCall: vi.fn().mockResolvedValue(undefined), sendText: vi.fn().mockResolvedValue(undefined),
    logger: { log: vi.fn(), warn: vi.fn() }, now: () => NOW, ...over,
  };
}

const ringing = (over: Record<string, unknown> = {}): any => ({ id: 'wa-1', from: '628111000111@c.us', isVideo: false, isGroup: false, ...over });
const events = (d: any) => d.emit.mock.calls.map((c: any[]) => c[0]);
const uniqueViolation = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  db.call.findUnique.mockReset().mockResolvedValue(null);
  db.call.findFirst.mockReset().mockResolvedValue(null);
  db.call.create.mockReset().mockImplementation(async ({ data }: any) => row({ ...data }));
  db.call.update.mockReset().mockImplementation(async ({ data }: any) => row(data));
  db.call.updateMany.mockReset().mockResolvedValue({ count: 1 });
  db.conversation.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ringing', () => {
  it('records the call under the normalized caller and announces it', async () => {
    db.conversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    const d = deps();
    await handleEngineCall(ringing(), d);
    expect(db.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ profileId: 'p1', waCallId: 'wa-1', fromJid: '628111000111@s.whatsapp.net', conversationId: 'conv-1' }),
    });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED]);
    const payload = d.emit.mock.calls[0][1];
    expect(payload).toMatchObject({ profileId: 'p1', callId: 'row-1', waCallId: 'wa-1', outcome: 'ringing' });
    // the webhook dispatchers dedupe delivery jobs on `id ?? messageId`, and one call emits several events
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('messageId');
    expect(d.emitRealtime).toHaveBeenCalledWith(payload);
  });

  it('a repeated offer changes nothing', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps();
    await handleEngineCall(ringing(), d);
    expect(db.call.create).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('an offer that lost the insert to a concurrent duplicate returns the winner and announces nothing', async () => {
    const winner = row();
    db.call.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    db.call.create.mockRejectedValue(uniqueViolation());
    const d = deps();
    await expect(handleEngineCall(ringing(), d)).resolves.toBe(winner);
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('an offer without a caller is not recorded', async () => {
    const d = deps();
    await expect(handleEngineCall(ringing({ from: '' }), d)).resolves.toBeNull();
    expect(db.call.create).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.logger.warn).toHaveBeenCalled();
  });
});

describe('auto-reject', () => {
  const settings = { autoRejectCalls: true, autoRejectCallMessage: '  Maaf, panggilan tidak dilayani.  ' };

  it('rejects, records it and replies once through the send-gated path', async () => {
    const d = deps({ settings });
    await handleEngineCall(ringing(), d);
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
    expect(db.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'row-1', outcome: 'ringing' },
      data: expect.objectContaining({ outcome: 'rejected', rejectedBy: 'auto', endedAt: NOW }),
    });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
    expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { autoReplySentAt: NOW } });
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(d.sendText).toHaveBeenCalledWith('628111000111@s.whatsapp.net', 'Maaf, panggilan tidak dilayani.');
  });

  it('does not reply again to a caller answered in the last 24 h', async () => {
    db.call.findFirst.mockResolvedValue({ id: 'older' });
    const d = deps({ settings });
    await handleEngineCall(ringing(), d);
    expect(d.rejectCall).toHaveBeenCalled();
    expect(db.call.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', fromJid: '628111000111@s.whatsapp.net', autoReplySentAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } },
      select: { id: true },
    });
    expect(d.sendText).not.toHaveBeenCalled();
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it('claims the reply before sending it, so a quick redial cannot be answered twice', async () => {
    const order: string[] = [];
    db.call.update.mockImplementation(async ({ data }: any) => { order.push(data.autoReplySentAt ? 'claim' : 'release'); return row(data); });
    const d = deps({ settings, sendText: vi.fn().mockImplementation(async () => { order.push('send'); }) });
    await handleEngineCall(ringing(), d);
    expect(order).toEqual(['claim', 'send']);
  });

  it('rejects silently without a message', async () => {
    const d = deps({ settings: { autoRejectCalls: true } });
    await handleEngineCall(ringing(), d);
    expect(d.rejectCall).toHaveBeenCalled();
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it('a group call is rejected but not answered', async () => {
    const d = deps({ settings });
    await handleEngineCall(ringing({ from: '120363000000000000@g.us', isGroup: true }), d);
    expect(d.rejectCall).toHaveBeenCalled();
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it('a failed reply releases the claim and does not throw', async () => {
    const d = deps({ settings, sendText: vi.fn().mockRejectedValue(new Error('429')) });
    await expect(handleEngineCall(ringing(), d)).resolves.toBeTruthy();
    expect(db.call.update).toHaveBeenLastCalledWith({ where: { id: 'row-1' }, data: { autoReplySentAt: null } });
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it('a failed reject leaves the call ringing, and the caller still gets the reply once', async () => {
    // e.g. the caller hung up first: the adapter throws "Call is not ringing any more"
    const d = deps({ settings, rejectCall: vi.fn().mockRejectedValue(new Error('Call is not ringing any more')) });
    const result = await handleEngineCall(ringing(), d);
    expect(result).toMatchObject({ outcome: 'ringing', rejectedBy: null });
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED]);
    expect(d.logger.warn).toHaveBeenCalled();
    expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { autoReplySentAt: NOW } });
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(d.sendText).toHaveBeenCalledWith('628111000111@s.whatsapp.net', 'Maaf, panggilan tidak dilayani.');
  });

  it('rejects at once, without waiting for the identity lookup', async () => {
    let answer!: (identity: unknown) => void;
    const resolveIdentity = vi.fn().mockReturnValue(new Promise((r) => { answer = r; }));
    const d = deps({ settings, resolveIdentity });
    const run = handleEngineCall(ringing({ from: '1234567@lid' }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveIdentity).toHaveBeenCalledTimes(1);
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
    expect(db.call.create).not.toHaveBeenCalled(); // the row waits for the caller's identity, the reject did not
    answer({ phoneJid: '628111000111@s.whatsapp.net' });
    await run;
    expect(db.call.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromJid: '628111000111@s.whatsapp.net', metadata: { lidJid: '1234567@lid' } }),
    });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
    expect(d.sendText).toHaveBeenCalledTimes(1);
  });

  it('rejects an offer without a caller too, but records and answers nothing', async () => {
    const d = deps({ settings });
    await expect(handleEngineCall(ringing({ from: '' }), d)).resolves.toBeNull();
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
    expect(db.call.create).not.toHaveBeenCalled();
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it('a repeated offer is not rejected again', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps({ settings });
    await handleEngineCall(ringing(), d);
    expect(d.rejectCall).not.toHaveBeenCalled();
  });
});

describe('later states', () => {
  it('ended -> unknown, without a notification (the call log usually follows)', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps();
    await handleEngineCall(ringing({ state: 'ended' }), d);
    expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'unknown' }) });
    expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('accepted -> answered elsewhere, follow-up done', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps();
    await handleEngineCall(ringing({ state: 'accepted' }), d);
    expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'answered_elsewhere', followUp: 'done' }) });
  });

  it('rejected on the phone -> rejectedBy device', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps();
    await handleEngineCall(ringing({ state: 'rejected' }), d);
    expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'rejected', rejectedBy: 'device' }) });
  });

  it('missed notifies once', async () => {
    db.call.findUnique.mockResolvedValue(row({ fromJid: '628222000222@s.whatsapp.net' }));
    const d = deps();
    await handleEngineCall(ringing({ state: 'missed' }), d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/Missed voice call/);
  });

  it('a state for a call never seen ringing is ignored', async () => {
    const d = deps();
    await expect(handleEngineCall(ringing({ state: 'ended' }), d)).resolves.toBeNull();
    expect(db.call.updateMany).not.toHaveBeenCalled();
  });

  it('a final outcome is never moved back', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'missed' }));
    const d = deps();
    await handleEngineCall(ringing({ state: 'ended' }), d);
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('losing a race re-reads the row and re-evaluates', async () => {
    db.call.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(row({ outcome: 'missed' }));
    db.call.updateMany.mockResolvedValueOnce({ count: 0 });
    const d = deps();
    const result = await handleEngineCall(ringing({ state: 'ended' }), d);
    expect(db.call.updateMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'missed' });
    expect(d.emit).not.toHaveBeenCalled();
  });
});

describe('call-log messages', () => {
  const entry = (over: Record<string, unknown> = {}): any => ({
    messageId: 'log-1', from: '628333000333@c.us', isVideo: false, outcome: 'missed', timestamp: new Date(NOW.getTime() - 5_000), ...over,
  });

  describe('that name their call (callId)', () => {
    const lookup = (waCallId: string) => ({ where: { profileId_waCallId: { profileId: 'p1', waCallId } } });

    it('refine that very call, found by its id, and notify a missed one', async () => {
      db.call.findUnique.mockResolvedValue(row({ outcome: 'unknown', waCallId: 'CALL1', fromJid: '628171000171@s.whatsapp.net' }));
      const d = deps();
      const result = await handleCallLog(entry({ callId: 'CALL1', from: '628171000171@c.us' }), d);
      expect(db.call.findUnique).toHaveBeenCalledWith(lookup('CALL1'));
      // the only findFirst is the replay guard: no search by caller and time
      expect(db.call.findFirst).toHaveBeenCalledTimes(1);
      expect(db.call.findFirst).toHaveBeenCalledWith({ where: { profileId: 'p1', metadata: { path: ['callLogMessageId'], equals: 'log-1' } }, select: { id: true } });
      expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'unknown' }, data: expect.objectContaining({ outcome: 'missed' }) });
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { callLogMessageId: 'log-1' } } });
      expect(db.call.create).not.toHaveBeenCalled();
      expect(events(d)).toEqual([AppEvents.CALL.UPDATED]);
      expect(d.notify).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ outcome: 'missed', metadata: { callLogMessageId: 'log-1' } });
    });

    it('saying rejected on a call we did not reject: declined on the phone', async () => {
      db.call.findUnique.mockResolvedValue(row({ waCallId: 'CALL1' }));
      const d = deps();
      await handleCallLog(entry({ callId: 'CALL1', outcome: 'rejected' }), d);
      expect(db.call.updateMany).toHaveBeenCalledWith({
        where: { id: 'row-1', outcome: 'ringing' },
        data: expect.objectContaining({ outcome: 'rejected', rejectedBy: 'device' }),
      });
      expect(events(d)).toEqual([AppEvents.CALL.REJECTED]);
      expect(d.notify).not.toHaveBeenCalled();
    });

    it('keep what is already in the call metadata', async () => {
      db.call.findUnique.mockResolvedValue(row({ outcome: 'unknown', waCallId: 'CALL1', metadata: { lidJid: '1234567@lid' }, fromJid: '628181000181@s.whatsapp.net' }));
      await handleCallLog(entry({ callId: 'CALL1', from: '628181000181@c.us' }), deps());
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { lidJid: '1234567@lid', callLogMessageId: 'log-1' } } });
    });

    it('of a call that is already final (our own auto-reject) are only remembered', async () => {
      db.call.findUnique.mockResolvedValue(row({ waCallId: 'CALL2', outcome: 'rejected', rejectedBy: 'auto', endedAt: NOW }));
      const d = deps();
      const result = await handleCallLog(entry({ callId: 'CALL2', outcome: 'rejected' }), d);
      expect(db.call.create).not.toHaveBeenCalled(); // no second row for the same call
      expect(db.call.updateMany).not.toHaveBeenCalled();
      expect(d.emit).not.toHaveBeenCalled();
      expect(d.emitRealtime).not.toHaveBeenCalled();
      expect(d.notify).not.toHaveBeenCalled();
      expect(db.call.update).toHaveBeenCalledTimes(1);
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { callLogMessageId: 'log-1' } } });
      expect(result).toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
    });

    it('of a call never seen ringing record it under the real call id', async () => {
      db.conversation.findFirst.mockResolvedValue({ id: 'conv-9' });
      const d = deps();
      await handleCallLog(entry({ callId: 'CALL3', from: '628174000174@c.us' }), d);
      expect(db.call.findUnique).toHaveBeenCalledTimes(1);
      expect(db.call.findUnique).toHaveBeenCalledWith(lookup('CALL3'));
      expect(db.call.findFirst).toHaveBeenCalledTimes(1); // the replay guard only
      expect(db.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          waCallId: 'CALL3', fromJid: '628174000174@s.whatsapp.net', isGroup: false, conversationId: 'conv-9', outcome: 'missed', rejectedBy: null,
          followUp: 'open', startedAt: new Date(NOW.getTime() - 5_000), endedAt: NOW, metadata: { source: 'call_log', callLogMessageId: 'log-1' },
        }),
      });
      expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
      expect(d.notify).toHaveBeenCalledTimes(1);
    });

    it('of a call never seen ringing: rejected means the phone, answered elsewhere needs no follow-up', async () => {
      await handleCallLog(entry({ callId: 'CALL3', outcome: 'rejected' }), deps());
      expect(db.call.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ outcome: 'rejected', rejectedBy: 'device', followUp: 'open' }) });
      await handleCallLog(entry({ callId: 'CALL3', messageId: 'log-2', outcome: 'answered_elsewhere' }), deps());
      expect(db.call.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ outcome: 'answered_elsewhere', rejectedBy: null, followUp: 'done' }) });
    });

    it('of a group call are recorded as a group call', async () => {
      await handleCallLog(entry({ callId: 'CALL3', from: '120363000000000000@g.us' }), deps());
      expect(db.call.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fromJid: '120363000000000000@g.us', isGroup: true }) });
    });

    it('of a call never seen ringing remember the @lid the caller arrived under', async () => {
      const resolveIdentity = vi.fn().mockResolvedValue({ phoneJid: '628191000191@s.whatsapp.net' });
      await handleCallLog(entry({ callId: 'CALL3', from: '1234567@lid' }), deps({ resolveIdentity }));
      expect(db.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fromJid: '628191000191@s.whatsapp.net', metadata: { source: 'call_log', callLogMessageId: 'log-1', lidJid: '1234567@lid' } }),
      });
    });

    it('never trigger the auto-reply: a call that rang while offline cannot be answered from its log (D8)', async () => {
      const d = deps({ settings: { autoRejectCalls: true, autoRejectCallMessage: 'Maaf' } });
      await handleCallLog(entry({ callId: 'CALL3', from: '628178000178@c.us' }), d);
      expect(db.call.create).toHaveBeenCalledTimes(1);
      expect(d.rejectCall).not.toHaveBeenCalled();
      expect(d.sendText).not.toHaveBeenCalled();
      expect(db.call.update).not.toHaveBeenCalled();
    });

    it('lost to a concurrent insert of the same call: settle the row that won', async () => {
      db.call.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ waCallId: 'CALL4', fromJid: '628177000177@s.whatsapp.net' }));
      db.call.create.mockRejectedValue(uniqueViolation());
      const d = deps();
      const result = await handleCallLog(entry({ callId: 'CALL4', from: '628177000177@c.us' }), d);
      expect(db.call.create).toHaveBeenCalledTimes(1);
      expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'missed' }) });
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { callLogMessageId: 'log-1' } } });
      expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
      expect(result).toMatchObject({ outcome: 'missed' });
    });

    it('with no caller and no call to settle create nothing', async () => {
      const d = deps();
      await expect(handleCallLog(entry({ callId: 'CALL3', from: '' }), d)).resolves.toBeNull();
      expect(db.call.create).not.toHaveBeenCalled();
      expect(d.logger.warn).toHaveBeenCalled();
    });
  });

  describe('without a call id (other engines, older builds): matched by caller and time', () => {
    it('refine the latest incoming call of the caller in the window, whatever its outcome so far', async () => {
      db.call.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ outcome: 'unknown', fromJid: '628333000333@s.whatsapp.net' }));
      const d = deps();
      await handleCallLog(entry(), d);
      const window = db.call.findFirst.mock.calls[1][0];
      expect(window).toMatchObject({
        where: { profileId: 'p1', direction: 'incoming', fromJid: { in: ['628333000333@s.whatsapp.net'] } },
        orderBy: { startedAt: 'desc' },
      });
      expect(window.where).not.toHaveProperty('outcome');
      expect(window.where.startedAt).toEqual({
        gte: new Date(NOW.getTime() - 5_000 - 2 * 3600_000),
        lte: new Date(NOW.getTime() - 5_000 + 30_000),
      });
      expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'unknown' }, data: expect.objectContaining({ outcome: 'missed' }) });
      expect(events(d)).toEqual([AppEvents.CALL.UPDATED]);
      expect(d.notify).toHaveBeenCalledTimes(1);
    });

    it('also look for the call under the @lid the caller arrived under', async () => {
      const resolveIdentity = vi.fn().mockResolvedValue({ phoneJid: '628192000192@s.whatsapp.net' });
      await handleCallLog(entry({ from: '7654321@lid' }), deps({ resolveIdentity }));
      expect(db.call.findFirst.mock.calls[1][0].where.fromJid).toEqual({ in: ['628192000192@s.whatsapp.net', '7654321@lid'] });
    });

    it('record a call the ringing of which was never seen', async () => {
      const d = deps();
      await handleCallLog(entry({ from: '628444000444@c.us' }), d);
      expect(db.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ waCallId: 'log:log-1', fromJid: '628444000444@s.whatsapp.net', outcome: 'missed', followUp: 'open', metadata: { source: 'call_log', callLogMessageId: 'log-1' } }),
      });
      expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
    });

    it('are recorded once', async () => {
      db.call.findUnique.mockResolvedValue(row({ waCallId: 'log:log-1' }));
      const d = deps();
      await expect(handleCallLog(entry(), d)).resolves.toBeNull();
      expect(db.call.create).not.toHaveBeenCalled();
    });

    it('remember the log on the call they refine', async () => {
      db.call.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ outcome: 'unknown', fromJid: '628666000666@s.whatsapp.net' }));
      const d = deps();
      await handleCallLog(entry({ from: '628666000666@c.us' }), d);
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { callLogMessageId: 'log-1' } } });
    });

    it('of a final call without a log (e.g. an auto-reject) are only remembered', async () => {
      db.call.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ outcome: 'rejected', rejectedBy: 'auto', endedAt: NOW, fromJid: '628175000175@s.whatsapp.net' }));
      const d = deps();
      await handleCallLog(entry({ from: '628175000175@c.us', outcome: 'rejected' }), d);
      expect(db.call.create).not.toHaveBeenCalled();
      expect(db.call.updateMany).not.toHaveBeenCalled();
      expect(d.emit).not.toHaveBeenCalled();
      expect(d.notify).not.toHaveBeenCalled();
      expect(db.call.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { metadata: { callLogMessageId: 'log-1' } } });
    });

    it('of a final call that has its log already are a call of their own', async () => {
      db.call.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ outcome: 'missed', metadata: { callLogMessageId: 'log-0' }, fromJid: '628176000176@s.whatsapp.net' }));
      const d = deps();
      await handleCallLog(entry({ from: '628176000176@c.us' }), d);
      expect(db.call.updateMany).not.toHaveBeenCalled();
      expect(db.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ waCallId: 'log:log-1', fromJid: '628176000176@s.whatsapp.net', metadata: { source: 'call_log', callLogMessageId: 'log-1' } }),
      });
      expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
    });

    it('without a caller are ignored', async () => {
      const d = deps();
      await expect(handleCallLog(entry({ from: '' }), d)).resolves.toBeNull();
      expect(db.call.findFirst).toHaveBeenCalledTimes(1); // the replay guard; no search for a caller that is not there
      expect(db.call.create).not.toHaveBeenCalled();
      expect(d.logger.warn).toHaveBeenCalled();
    });
  });

  it('a replayed log that already refined a call changes nothing', async () => {
    db.call.findFirst.mockResolvedValueOnce({ id: 'row-1' }); // the callLogMessageId lookup
    const d = deps();
    await expect(handleCallLog(entry(), d)).resolves.toBeNull();
    expect(db.call.findFirst).toHaveBeenCalledWith({ where: { profileId: 'p1', metadata: { path: ['callLogMessageId'], equals: 'log-1' } }, select: { id: true } });
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(db.call.create).not.toHaveBeenCalled();
  });

  it('older than a day are ignored', async () => {
    const d = deps();
    await expect(handleCallLog(entry({ timestamp: new Date(NOW.getTime() - 2 * 24 * 3600_000) }), d)).resolves.toBeNull();
    expect(db.call.findFirst).not.toHaveBeenCalled();
  });
});

// whatsapp-web.js reports `ended` and, 10-15 ms later, the final call log, so the two handlers can overlap.
// The compare-and-set on the stored outcome has to give the same result in either order.
describe('ended and the call log racing', () => {
  // one caller per test: a missed-call notification is throttled per caller
  const scene = (n: number) => {
    const number = `62818000018${n}`;
    return {
      entry: (over: Record<string, unknown> = {}): any => ({
        messageId: 'log-1', callId: 'wa-1', from: `${number}@c.us`, isVideo: false, outcome: 'missed', timestamp: new Date(NOW.getTime() - 5_000), ...over,
      }),
      stored: (over: Record<string, unknown> = {}) => row({ fromJid: `${number}@s.whatsapp.net`, ...over }),
    };
  };

  it('ended first, the log after: the log refines unknown to the final outcome', async () => {
    const { entry, stored } = scene(1);
    const d = deps();
    db.call.findUnique.mockResolvedValueOnce(stored());
    await handleEngineCall(ringing({ state: 'ended' }), d);
    db.call.findUnique.mockResolvedValueOnce(stored({ outcome: 'unknown' }));
    await handleCallLog(entry(), d);
    expect(db.call.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'unknown' }) });
    expect(db.call.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'row-1', outcome: 'unknown' }, data: expect.objectContaining({ outcome: 'missed' }) });
    expect(events(d)).toEqual([AppEvents.CALL.ENDED, AppEvents.CALL.UPDATED]);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('ended won while the log was still reading: the log loses the compare-and-set and refines the row it re-reads', async () => {
    const { entry, stored } = scene(2);
    const d = deps();
    db.call.findUnique.mockResolvedValueOnce(stored()).mockResolvedValueOnce(stored({ outcome: 'unknown' }));
    db.call.updateMany.mockResolvedValueOnce({ count: 0 });
    await handleCallLog(entry(), d);
    expect(db.call.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'missed' }) });
    expect(db.call.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'row-1', outcome: 'unknown' }, data: expect.objectContaining({ outcome: 'missed' }) });
    expect(events(d)).toEqual([AppEvents.CALL.UPDATED]);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('the log first, a late ended after: the log stays, ended adds no event and no notification', async () => {
    const { entry, stored } = scene(3);
    const d = deps();
    db.call.findUnique.mockResolvedValueOnce(stored());
    await handleCallLog(entry(), d);
    expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
    expect(d.notify).toHaveBeenCalledTimes(1);

    // `ended` read the row before the log's write landed, then lost the compare-and-set
    db.call.findUnique.mockResolvedValueOnce(stored()).mockResolvedValueOnce(stored({ outcome: 'missed', endedAt: NOW }));
    db.call.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await handleEngineCall(ringing({ state: 'ended' }), d);
    expect(result).toMatchObject({ outcome: 'missed' });
    expect(db.call.updateMany).toHaveBeenCalledTimes(2); // the log's write and ended's lost one: nothing else
    expect(events(d)).toEqual([AppEvents.CALL.ENDED]);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });
});

describe('timers and sweeps', () => {
  it('a call still ringing after the ring timeout becomes unknown and notifies', async () => {
    const d = deps();
    const created = row({ fromJid: '628555000555@s.whatsapp.net' });
    db.call.create.mockResolvedValue(created);
    await handleEngineCall(ringing({ from: '628555000555@c.us' }), d);
    db.call.findUnique.mockResolvedValue(created);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'unknown' }) });
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('a call settled before the ring timeout is left alone when it expires', async () => {
    const d = deps();
    const created = row({ fromJid: '628556000556@s.whatsapp.net' });
    db.call.create.mockResolvedValue(created);
    await handleEngineCall(ringing({ from: '628556000556@c.us' }), d);
    db.call.findUnique.mockResolvedValue(created);
    await handleEngineCall(ringing({ state: 'accepted' }), d); // answered on the phone: the timer is cleared
    db.call.updateMany.mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('the boot sweep closes rows left ringing', async () => {
    db.call.updateMany.mockResolvedValue({ count: 2 });
    await expect(closeStaleRingingCalls(NOW)).resolves.toBe(2);
    expect(db.call.updateMany).toHaveBeenCalledWith({
      where: { outcome: 'ringing', startedAt: { lt: new Date(NOW.getTime() - 90_000) } },
      data: { outcome: 'unknown', endedAt: NOW },
    });
  });
});

describe('rejectCallByAgent', () => {
  it('rejects a ringing call through the engine and records the agent', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps();
    await rejectCallByAgent('row-1', d);
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
    expect(db.call.updateMany).toHaveBeenCalledWith({ where: { id: 'row-1', outcome: 'ringing' }, data: expect.objectContaining({ outcome: 'rejected', rejectedBy: 'agent' }) });
  });

  it('refuses a call that no longer rings, or of another profile', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'missed' }));
    await expect(rejectCallByAgent('row-1', deps())).rejects.toThrow(/^CALL_NOT_RINGING/);
    db.call.findUnique.mockResolvedValue(row({ profileId: 'p2' }));
    await expect(rejectCallByAgent('row-1', deps())).rejects.toThrow(/^CALL_NOT_FOUND/);
  });
});

describe('toCallPayload', () => {
  it('uses callId, ISO dates, and neither id nor messageId (the webhook job dedupe keys)', () => {
    const p = toCallPayload(row({ endedAt: NOW }));
    expect(p).toMatchObject({ callId: 'row-1', startedAt: NOW.toISOString(), endedAt: NOW.toISOString(), from: '628111000111@s.whatsapp.net' });
    expect(p).not.toHaveProperty('id');
    expect(p).not.toHaveProperty('messageId');
  });
});

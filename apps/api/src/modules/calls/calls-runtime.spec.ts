// The calls runtime (packages/engine-runtime/src/calls.ts): engine signals and
// call-log messages become `calls` rows plus call.* events. Prisma is mocked.
//
// notifyMissed throttles per profile and caller for 10 minutes, per process and with the
// clock frozen at NOW. A test that asserts a notification therefore uses a caller of its own,
// and one that must prove a timer sends none moves the clock past the throttle first (a
// notification held back by the throttle would look the same as one never sent).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    call: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    conversation: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import {
  handleEngineCall, handleCallLog, closeStaleRingingCalls, rejectCallByAgent, toCallPayload, __callsInFlightForTests,
} from '@multiwa/engine-runtime';

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

// A test that fails before it resolves its deferreds would leave their calls registered, and the registry
// outlives the test: every later test of the file would wait for those calls. afterEach lets them go.
const unresolved = new Set<() => void>();
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  unresolved.add(() => resolve(undefined as T));
  return { promise, resolve };
};

// An in-memory `calls` table, for the specs in which a row has to appear and change between reads.
// Starts empty, or with `initial`. Returns a getter for the stored row (null until it is created).
function fakeCalls(initial: any = null): () => any {
  let stored: any = initial;
  const copy = () => (stored ? { ...stored } : null);
  db.call.findFirst.mockImplementation(async ({ where }: any) => {
    if (!stored) return null;
    if (where.metadata) return stored.metadata?.callLogMessageId === where.metadata.equals ? copy() : null; // the replay guard
    if (where.fromJid?.in) { // a call log without a call id: the caller's call within the time window
      const { gte, lte } = where.startedAt;
      return where.fromJid.in.includes(stored.fromJid) && stored.startedAt >= gte && stored.startedAt <= lte ? copy() : null;
    }
    return null; // the lookup of an earlier reply: nobody was answered before
  });
  db.call.findUnique.mockImplementation(async ({ where }: any) => {
    const byCallId = where.profileId_waCallId;
    const hit = byCallId ? stored?.profileId === byCallId.profileId && stored?.waCallId === byCallId.waCallId : stored?.id === where.id;
    return hit ? copy() : null;
  });
  db.call.create.mockImplementation(async ({ data }: any) => {
    if (stored) throw uniqueViolation();
    stored = row({ ...data });
    return copy();
  });
  db.call.updateMany.mockImplementation(async ({ where, data }: any) => {
    if (stored?.id !== where.id || stored.outcome !== where.outcome) return { count: 0 };
    stored = { ...stored, ...data };
    return { count: 1 };
  });
  db.call.update.mockImplementation(async ({ data }: any) => {
    stored = { ...stored, ...data };
    return copy();
  });
  return () => stored;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  db.call.findUnique.mockReset().mockResolvedValue(null);
  db.call.findFirst.mockReset().mockResolvedValue(null);
  db.call.create.mockReset().mockImplementation(async ({ data }: any) => row({ ...data }));
  db.call.update.mockReset().mockImplementation(async ({ data }: any) => row(data));
  db.call.updateMany.mockReset().mockResolvedValue({ count: 1 });
  db.conversation.findFirst.mockReset().mockResolvedValue(null);
});
afterEach(async () => {
  unresolved.forEach((release) => release());
  unresolved.clear();
  await vi.advanceTimersByTimeAsync(0);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  // whatever a test did, no call may stay registered as being processed
  expect(__callsInFlightForTests()).toBe(0);
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

  it('rejects before it reads the calls table: a table that hangs does not delay the reject', async () => {
    const table = deferred<null>();
    db.call.findUnique.mockReturnValue(table.promise);
    const d = deps({ settings });
    const run = handleEngineCall(ringing(), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(db.call.findUnique).toHaveBeenCalledTimes(1); // stuck on the read...
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1'); // ...and the reject is out already
    table.resolve(null);
    await run;
  });

  it('rejects before it reads the calls table: a table that is missing does not stop the reject', async () => {
    db.call.findUnique.mockRejectedValue(new Error('relation "calls" does not exist'));
    const d = deps({ settings });
    await expect(handleEngineCall(ringing(), d)).rejects.toThrow('relation "calls" does not exist');
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
  });

  it('an offer replayed for a call that is already recorded (after a restart) is rejected again; nothing is recorded, announced or answered twice', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps({ settings });
    await expect(handleEngineCall(ringing(), d)).resolves.toMatchObject({ id: 'row-1' });
    expect(d.rejectCall).toHaveBeenCalledTimes(1);
    expect(d.rejectCall).toHaveBeenCalledWith('wa-1');
    expect(db.call.create).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.sendText).not.toHaveBeenCalled();
  });

  it('that second reject is harmless when the engine has let the call go: logged, not thrown', async () => {
    db.call.findUnique.mockResolvedValue(row({ outcome: 'rejected', rejectedBy: 'auto', endedAt: NOW }));
    const d = deps({ settings, rejectCall: vi.fn().mockRejectedValue(new Error('Call is not ringing any more')) });
    await expect(handleEngineCall(ringing(), d)).resolves.toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
    await vi.advanceTimersByTimeAsync(0); // nothing waits for the reject of a replayed offer
    expect(d.rejectCall).toHaveBeenCalledTimes(1);
    expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Call is not ringing any more'));
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('a replayed offer does not hold the signals of its call behind its own reject, which can take as long as the engine does', async () => {
    const stored = fakeCalls(row());
    const engine = deferred();
    const d = deps({ settings, rejectCall: vi.fn().mockReturnValue(engine.promise) });
    const replay = handleEngineCall(ringing(), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.rejectCall).toHaveBeenCalledTimes(1);

    const end = handleEngineCall(ringing({ state: 'ended' }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'unknown' }); // nothing was recorded for the replay: nothing to wait for

    engine.resolve();
    await Promise.all([replay, end]);
  });

  // The call is recorded and rejected by now: a database blip while the reply is prepared must not turn into a failed ringing step.
  it.each([
    ['looking up earlier replies', 'findFirst'],
    ['claiming the reply', 'update'],
  ])('a database error while %s skips the reply and fails nothing', async (_step, method) => {
    db.call[method].mockRejectedValue(new Error('db blip'));
    const d = deps({ settings });
    await expect(handleEngineCall(ringing(), d)).resolves.toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
    expect(d.sendText).not.toHaveBeenCalled();
    expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('db blip'));
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
  });

  it('a reply that fails, with a claim that cannot be released either, is logged twice and fails nothing', async () => {
    db.call.update.mockResolvedValueOnce(row()).mockRejectedValue(new Error('db blip')); // the claim works, the release does not
    const d = deps({ settings, sendText: vi.fn().mockRejectedValue(new Error('429')) });
    await expect(handleEngineCall(ringing(), d)).resolves.toMatchObject({ outcome: 'rejected' });
    expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('429'));
    expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('db blip'));
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

// The engine reports the end of a call and its call log within milliseconds of each other, our own
// reject is echoed back just as fast, and the ringing step of the call is meanwhile looking up the
// caller (a page round trip, often 100+ ms for an @lid) or sending the reply. Every signal of a call
// has to wait until the call is recorded (its row exists and says who rejected it); otherwise it reads a
// row that does not exist yet, or one that does not say who rejected, and the ringing step is left with a
// row it did not make. The reply is not part of that: it goes through the send gate and can take minutes.
describe('signals of a call whose ringing step is still running', () => {
  const settings = { autoRejectCalls: true, autoRejectCallMessage: 'Maaf' };
  const lid = '1234567@lid';
  const phoneJid = '628111000111@s.whatsapp.net';
  const logOf = (over: Record<string, unknown> = {}): any => ({
    messageId: 'log-1', callId: 'wa-1', from: lid, isVideo: false, outcome: 'rejected', timestamp: new Date(NOW.getTime() - 5_000), ...over,
  });
  // The first identity lookup (the ringing step's) hangs until `lookup.resolve`; later ones answer at once.
  const slowLookup = () => {
    const lookup = deferred<{ phoneJid: string }>();
    return { lookup, resolveIdentity: vi.fn().mockReturnValueOnce(lookup.promise).mockResolvedValue({ phoneJid }) };
  };

  it('a Rejected log that arrives during the identity lookup waits: one row, made by the ringing step, rejected by auto, answered once', async () => {
    const stored = fakeCalls();
    const { lookup, resolveIdentity } = slowLookup();
    const d = deps({ settings, resolveIdentity });
    const ring = handleEngineCall(ringing({ from: lid }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.rejectCall).toHaveBeenCalledTimes(1); // reject-first: out before the caller is known
    const log = handleCallLog(logOf(), d);
    await vi.advanceTimersByTimeAsync(0); // the log gets as far as it can
    expect(db.call.create).not.toHaveBeenCalled(); // it does not make a row of its own
    lookup.resolve({ phoneJid });
    await Promise.all([ring, log]);

    expect(db.call.create).toHaveBeenCalledTimes(1);
    expect(db.call.create.mock.calls[0][0].data.metadata).toEqual({ lidJid: lid }); // not the log's `source: 'call_log'`
    expect(stored()).toMatchObject({ fromJid: phoneJid, outcome: 'rejected', rejectedBy: 'auto', metadata: { lidJid: lid, callLogMessageId: 'log-1' } });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
    expect(d.rejectCall).toHaveBeenCalledTimes(1);
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(d.sendText).toHaveBeenCalledWith(phoneJid, 'Maaf');
    await expect(log).resolves.toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
  });

  it("Baileys' rejected echo of our own reject, landing before the reject has settled, is not taken for the phone", async () => {
    const stored = fakeCalls();
    const rejected = deferred();
    const d = deps({ settings, rejectCall: vi.fn().mockReturnValue(rejected.promise) });
    const ring = handleEngineCall(ringing(), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'ringing' }); // the row is there, the reject has not come back yet
    const echo = handleEngineCall(ringing({ state: 'rejected' }), d);
    await vi.advanceTimersByTimeAsync(0);
    rejected.resolve();
    await Promise.all([ring, echo]);

    expect(stored()).toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
    expect(db.call.updateMany).toHaveBeenCalledTimes(1);
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
    expect(d.sendText).toHaveBeenCalledTimes(1);
  });

  it('a repeated offer joins the one being recorded: one reject, one row, one answer', async () => {
    fakeCalls();
    const { lookup, resolveIdentity } = slowLookup();
    const d = deps({ settings, resolveIdentity });
    const first = handleEngineCall(ringing({ from: lid }), d);
    await vi.advanceTimersByTimeAsync(0);
    const again = handleEngineCall(ringing({ from: lid }), d);
    await vi.advanceTimersByTimeAsync(0);
    lookup.resolve({ phoneJid });
    const [a, b] = await Promise.all([first, again]);

    expect(d.rejectCall).toHaveBeenCalledTimes(1);
    expect(db.call.create).toHaveBeenCalledTimes(1);
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.REJECTED]);
    expect(b).toBe(a); // the repeat returns what the first one made
  });

  it('an end that arrives before the row exists waits for it, instead of being dropped as a call never seen', async () => {
    const stored = fakeCalls();
    const { lookup, resolveIdentity } = slowLookup();
    const d = deps({ resolveIdentity }); // no auto-reject
    const ring = handleEngineCall(ringing({ from: lid }), d);
    await vi.advanceTimersByTimeAsync(0);
    const end = handleEngineCall(ringing({ from: lid, state: 'ended' }), d);
    await vi.advanceTimersByTimeAsync(0);
    lookup.resolve({ phoneJid });
    await Promise.all([ring, end]);

    expect(stored()).toMatchObject({ fromJid: phoneJid, outcome: 'unknown' });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.ENDED]);
  });

  it('a ringing step that fails does not fail the signals that waited for it', async () => {
    const stored = fakeCalls();
    db.call.create.mockRejectedValueOnce(new Error('db down'));
    const d = deps();
    const caller = '628200000011@c.us'; // a log of a missed call notifies
    const ring = handleEngineCall(ringing({ from: caller }), d);
    const end = handleEngineCall(ringing({ from: caller, state: 'ended' }), d);
    const log = handleCallLog(logOf({ from: caller, outcome: 'missed' }), d);
    await expect(ring).rejects.toThrow('db down');
    await end; // nothing recorded, nothing to end: ignored, not failed
    await expect(log).resolves.toMatchObject({ outcome: 'missed' }); // no row came out of the ringing step: recorded from the log
    expect(stored()).toMatchObject({ outcome: 'missed', metadata: { source: 'call_log', callLogMessageId: 'log-1' } });
  });

  it('a log that names another call does not wait for this one', async () => {
    const { lookup, resolveIdentity } = slowLookup();
    const d = deps({ resolveIdentity });
    const ring = handleEngineCall(ringing({ from: lid }), d);
    await vi.advanceTimersByTimeAsync(0);
    await handleCallLog(logOf({ callId: 'wa-2', from: '628200000012@c.us', outcome: 'missed' }), d);
    expect(db.call.create).toHaveBeenCalledWith({ data: expect.objectContaining({ waCallId: 'wa-2' }) }); // done while wa-1 is still pending
    lookup.resolve({ phoneJid });
    await ring;
  });

  it('a slow reply holds nobody back: the end of the call and its call log are recorded and notified while the reply is still being sent', async () => {
    const stored = fakeCalls();
    const reply = deferred();
    const caller = '628200000021@c.us'; // a missed call notifies, once per caller
    // the caller hung up before we could reject: the row stays ringing, and the reply sits in the send gate
    const rejectCall = vi.fn().mockRejectedValue(new Error('Call is not ringing any more'));
    const d = deps({ settings, rejectCall, sendText: vi.fn().mockReturnValue(reply.promise) });
    const ring = handleEngineCall(ringing({ from: caller }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ outcome: 'ringing' });

    const end = handleEngineCall(ringing({ from: caller, state: 'ended' }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'unknown' }); // not held behind the reply

    const log = handleCallLog(logOf({ from: caller, outcome: 'missed' }), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'missed', metadata: { callLogMessageId: 'log-1' } });
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/Missed voice call/);
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.ENDED, AppEvents.CALL.UPDATED]);

    reply.resolve();
    await Promise.all([ring, end, log]);
    expect(d.sendText).toHaveBeenCalledTimes(1);
  });

  describe('a call log without a call id (other engines, older builds)', () => {
    it('waits for every call of its profile that is still being recorded, then refines the one it finds by caller and time', async () => {
      const stored = fakeCalls();
      const { lookup, resolveIdentity } = slowLookup();
      const d = deps({ resolveIdentity });
      const ring = handleEngineCall(ringing({ from: lid }), d);
      await vi.advanceTimersByTimeAsync(0);
      const log = handleCallLog(logOf({ callId: undefined, outcome: 'missed' }), d); // nothing to say which call it is
      await vi.advanceTimersByTimeAsync(0);
      expect(db.call.create).not.toHaveBeenCalled(); // it does not make a `log:` row of its own for a call about to be recorded
      lookup.resolve({ phoneJid });
      await Promise.all([ring, log]);

      expect(db.call.create).toHaveBeenCalledTimes(1);
      expect(stored()).toMatchObject({ waCallId: 'wa-1', fromJid: phoneJid, outcome: 'missed', metadata: { lidJid: lid, callLogMessageId: 'log-1' } });
      expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.ENDED]);
    });

    it('does not wait for the calls of another profile', async () => {
      const { lookup, resolveIdentity } = slowLookup();
      const ring = handleEngineCall(ringing({ from: lid }), deps({ profileId: 'p2', resolveIdentity }));
      await vi.advanceTimersByTimeAsync(0);
      await handleCallLog(logOf({ callId: undefined, from: '628200000022@c.us', outcome: 'missed' }), deps());
      expect(db.call.create).toHaveBeenCalledWith({ data: expect.objectContaining({ profileId: 'p1', waCallId: 'log:log-1' }) }); // done while p2's call is pending
      lookup.resolve({ phoneJid });
      await ring;
    });
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
    expect(vi.getTimerCount()).toBe(0); // it notified already: no grace period for a call log follows
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

// An `ended` call is `unknown`: it stopped ringing and we do not know how. The call log usually says
// within milliseconds (and notifies), but Baileys has no call logs and whatsapp-web.js loses some, so a
// call the log never settles is reported as unanswered once CALL_LOG_GRACE_MS (default 60 s) is over.
describe('an ended call that no call log settles', () => {
  // one caller per test: a missed-call notification is throttled per caller
  const scene = (n: number) => {
    const number = `62820000000${n}`;
    return {
      incoming: ringing({ from: `${number}@c.us` }),
      log: (outcome: string): any => ({ messageId: 'log-1', callId: 'wa-1', from: `${number}@c.us`, isVideo: false, outcome, timestamp: new Date(NOW.getTime() - 5_000) }),
    };
  };

  it('is reported as unanswered when the grace period is over, once', async () => {
    const stored = fakeCalls();
    const { incoming } = scene(1);
    const d = deps();
    await handleEngineCall(incoming, d);
    await handleEngineCall({ ...incoming, state: 'ended' }, d);
    expect(stored()).toMatchObject({ outcome: 'unknown' });
    expect(d.notify).not.toHaveBeenCalled(); // the call log usually follows
    await vi.advanceTimersByTimeAsync(59_999);
    expect(d.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/Unanswered voice call\?/);
    expect(d.notify.mock.calls[0][2]).toMatchObject({ callId: 'row-1', from: '628200000001@s.whatsapp.net' });
    expect(events(d)).toEqual([AppEvents.CALL.RECEIVED, AppEvents.CALL.ENDED]); // reported, not changed
    expect(stored()).toMatchObject({ outcome: 'unknown' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000); // neither the ring timeout nor a second grace period follows
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('is notified once, by the Missed log, when that arrives within the grace period', async () => {
    const stored = fakeCalls();
    const { incoming, log } = scene(2);
    let at = NOW;
    const d = deps({ now: () => at });
    await handleEngineCall(incoming, d);
    expect(vi.getTimerCount()).toBe(1); // the ring timeout
    await handleEngineCall({ ...incoming, state: 'ended' }, d);
    expect(vi.getTimerCount()).toBe(1); // replaced by the grace period: one timer per call
    await vi.advanceTimersByTimeAsync(15);
    await handleCallLog(log('missed'), d);
    expect(stored()).toMatchObject({ outcome: 'missed' });
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/Missed voice call/);
    expect(vi.getTimerCount()).toBe(0); // the log settled the call: nothing left to wait for

    at = new Date(NOW.getTime() + 11 * 60_000); // past the throttle, which would hide a second notification
    await vi.advanceTimersByTimeAsync(120_000);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('is not notified at all when the log says it was answered elsewhere', async () => {
    const stored = fakeCalls();
    const { incoming, log } = scene(3);
    const d = deps();
    await handleEngineCall(incoming, d);
    await handleEngineCall({ ...incoming, state: 'ended' }, d);
    expect(vi.getTimerCount()).toBe(1);
    await handleCallLog(log('answered_elsewhere'), d);
    expect(stored()).toMatchObject({ outcome: 'answered_elsewhere', followUp: 'done' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('does nothing when the row was settled behind its back (another process, a lost timer clear)', async () => {
    const stored = fakeCalls();
    const { incoming } = scene(4);
    const d = deps();
    await handleEngineCall(incoming, d);
    await handleEngineCall({ ...incoming, state: 'ended' }, d);
    db.call.findUnique.mockResolvedValueOnce({ ...stored(), outcome: 'missed' }); // what the timer reads when it fires
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('waits CALL_LOG_GRACE_MS when that is set', async () => {
    vi.stubEnv('CALL_LOG_GRACE_MS', '5000');
    fakeCalls();
    const { incoming } = scene(5);
    const d = deps();
    await handleEngineCall(incoming, d);
    await handleEngineCall({ ...incoming, state: 'ended' }, d);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(d.notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(d.notify).toHaveBeenCalledTimes(1);
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

  // The engine reports a reject within milliseconds of performing it: Baileys echoes a `rejected` state,
  // whatsapp-web.js adds a Rejected call log. Either can reach us before the reject we asked for has come
  // back, and must not be taken for the phone's.
  describe('while the engine is still rejecting', () => {
    const during = async (signal: (d: any) => Promise<unknown>) => {
      const stored = fakeCalls(row());
      const engine = deferred();
      const d = deps({ rejectCall: vi.fn().mockReturnValue(engine.promise) });
      const reject = rejectCallByAgent('row-1', d);
      await vi.advanceTimersByTimeAsync(0);
      expect(d.rejectCall).toHaveBeenCalledWith('wa-1');

      const reported = signal(d);
      await vi.advanceTimersByTimeAsync(0);
      expect(stored()).toMatchObject({ outcome: 'ringing' }); // it waits instead of relabelling the call

      engine.resolve();
      await Promise.all([reject, reported]);
      expect(stored()).toMatchObject({ outcome: 'rejected', rejectedBy: 'agent' });
      expect(db.call.updateMany).toHaveBeenCalledTimes(1);
      expect(events(d)).toEqual([AppEvents.CALL.REJECTED]);
    };

    it("Baileys' rejected echo is not taken for the phone", () => during((d) => handleEngineCall(ringing({ state: 'rejected' }), d)));

    it('the Rejected call log is not taken for the phone', () =>
      during((d) => handleCallLog({
        messageId: 'log-1', callId: 'wa-1', from: '628111000111@c.us', isVideo: false, outcome: 'rejected', timestamp: new Date(NOW.getTime() - 5_000),
      }, d)));
  });

  it('waits for the ringing step that is still settling the call, then judges it as it stands: already rejected, by the auto-reject', async () => {
    const stored = fakeCalls();
    const auto = deferred();
    const d = deps({ settings: { autoRejectCalls: true }, rejectCall: vi.fn().mockReturnValue(auto.promise) });
    const ring = handleEngineCall(ringing(), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'ringing' }); // announced; its auto-reject is on the way

    const agent = rejectCallByAgent('row-1', d);
    const refused = expect(agent).rejects.toThrow(/^CALL_NOT_RINGING: row-1$/);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.rejectCall).toHaveBeenCalledTimes(1); // the agent does not ask the engine behind the ringing step's back

    auto.resolve();
    await Promise.all([ring, refused]);
    expect(d.rejectCall).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ outcome: 'rejected', rejectedBy: 'auto' });
  });

  it('is not held behind the reply of a ringing step that has recorded the call and is only replying', async () => {
    const stored = fakeCalls();
    const reply = deferred();
    // the auto-reject failed (the page hiccuped) and the reply sits in the send gate; the agent's reject works
    const rejectCall = vi.fn().mockRejectedValueOnce(new Error('page gone')).mockResolvedValue(undefined);
    const d = deps({ settings: { autoRejectCalls: true, autoRejectCallMessage: 'Maaf' }, rejectCall, sendText: vi.fn().mockReturnValue(reply.promise) });
    const ring = handleEngineCall(ringing(), d);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(stored()).toMatchObject({ outcome: 'ringing' });

    const agent = rejectCallByAgent('row-1', d);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored()).toMatchObject({ outcome: 'rejected', rejectedBy: 'agent' });

    reply.resolve();
    await Promise.all([ring, agent]);
  });

  it('leaves the call ringing and passes the engine error on when the engine cannot reject', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps({ rejectCall: vi.fn().mockRejectedValue(new Error('page crashed')) });
    await expect(rejectCallByAgent('row-1', d)).rejects.toThrow('page crashed');
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('reports a call the engine no longer holds as CALL_NOT_RINGING (the REST layer answers 409, not 500) and leaves the row to the signals that follow', async () => {
    db.call.findUnique.mockResolvedValue(row());
    const d = deps({ rejectCall: vi.fn().mockRejectedValue(new Error('Call is not ringing any more')) });
    await expect(rejectCallByAgent('row-1', d)).rejects.toThrow(/^CALL_NOT_RINGING: row-1$/);
    expect(db.call.updateMany).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
  });
});

describe('missed-call notifications', () => {
  // The throttle is per process, profile and caller: each test has callers of its own.
  const missed = (n: number, d: any, waCallId = 'wa-1') => {
    const number = `62830000003${n}`;
    db.call.findUnique.mockResolvedValue(row({ waCallId, fromJid: `${number}@s.whatsapp.net` }));
    return handleEngineCall(ringing({ id: waCallId, from: `${number}@c.us`, state: 'missed' }), d);
  };

  it('two calls of one caller within ten minutes are one notification; one after that, or from another caller, notifies again', async () => {
    let at = NOW;
    const d = deps({ now: () => at });
    await missed(1, d, 'wa-1');
    expect(d.notify).toHaveBeenCalledTimes(1);
    at = new Date(NOW.getTime() + 9 * 60_000);
    await missed(1, d, 'wa-2');
    expect(d.notify).toHaveBeenCalledTimes(1);
    await missed(2, d, 'wa-3');
    expect(d.notify).toHaveBeenCalledTimes(2);
    at = new Date(NOW.getTime() + 11 * 60_000);
    await missed(1, d, 'wa-4');
    expect(d.notify).toHaveBeenCalledTimes(3);
  });

  it('"Unanswered?" at the end of the grace period, then the Missed log after all: one notification, not two', async () => {
    const stored = fakeCalls();
    const caller = '628300000041@c.us';
    const d = deps();
    await handleEngineCall(ringing({ from: caller }), d);
    await handleEngineCall(ringing({ from: caller, state: 'ended' }), d);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatch(/Unanswered voice call\?/);

    await handleCallLog({ messageId: 'log-1', callId: 'wa-1', from: caller, isVideo: false, outcome: 'missed', timestamp: new Date(NOW.getTime() - 5_000) }, d);
    expect(stored()).toMatchObject({ outcome: 'missed' }); // the call is settled...
    expect(d.notify).toHaveBeenCalledTimes(1); // ...but the caller was told already
  });

  it('a second signal of the same caller while a notification is on its way does not send another', async () => {
    const sending = deferred();
    const d = deps({ notify: vi.fn().mockReturnValue(sending.promise) });
    const first = missed(3, d, 'wa-1');
    await vi.advanceTimersByTimeAsync(0);
    const second = missed(3, d, 'wa-2');
    await vi.advanceTimersByTimeAsync(0);
    expect(d.notify).toHaveBeenCalledTimes(1);
    sending.resolve();
    await Promise.all([first, second]);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it('a notification that failed does not hide the next one for ten minutes', async () => {
    const d = deps({ notify: vi.fn().mockRejectedValueOnce(new Error('push down')).mockResolvedValue(undefined) });
    await missed(4, d, 'wa-1');
    await missed(4, d, 'wa-2');
    expect(d.notify).toHaveBeenCalledTimes(2);
  });

  describe('collaborators that fail never fail the runtime', () => {
    it.each([
      ['rejects', 5, () => vi.fn().mockRejectedValue(new Error('push down'))],
      ['throws', 6, () => vi.fn(() => { throw new Error('push down'); })],
    ])('a notify that %s: the signal still completes, and the failure is logged', async (_how, n, makeNotify) => {
      const d = deps({ notify: makeNotify() });
      await expect(missed(n, d)).resolves.toMatchObject({ outcome: 'missed' });
      expect(d.notify).toHaveBeenCalledTimes(1);
      expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('push down'));
    });

    it.each([
      ['emit', { emit: vi.fn(() => { throw new Error('bus down'); }) }, 'emitRealtime'],
      ['emitRealtime', { emitRealtime: vi.fn(() => { throw new Error('bus down'); }) }, 'emit'],
    ])('a %s that throws: the call is still recorded and updated, and the other channel still hears it', async (_which, broken, other) => {
      const d = deps(broken);
      await expect(handleEngineCall(ringing(), d)).resolves.toMatchObject({ id: 'row-1' });
      db.call.findUnique.mockResolvedValue(row());
      await expect(handleEngineCall(ringing({ state: 'ended' }), d)).resolves.toMatchObject({ outcome: 'unknown' });
      expect(d[other]).toHaveBeenCalledTimes(2); // the ringing and the end
      expect(d.logger.warn).toHaveBeenCalledWith(expect.stringContaining('bus down'));
    });
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

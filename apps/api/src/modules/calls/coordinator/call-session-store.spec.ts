// The coordinator's writes are compare-and-sets: each one names, in its WHERE, the state it may change, so a write
// that lost a race (to another agent, to the runtime moving the outcome) changes nothing and says so.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { call: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } },
}));

import { prisma } from '@multiwa/database';
import { claimCall, findCallForAnswer, markAnswered, markEnded, reconcileAfterRestart, releaseClaim } from './call-session-store';

const db = (prisma as any).call;
const AT = new Date('2026-10-30T08:00:00Z');
const ANSWERED = { id: 'c1', outcome: 'answered', answeredAt: new Date('2026-10-30T07:58:30Z'), endedAt: null };

beforeEach(() => {
  db.findUnique.mockReset();
  db.findMany.mockReset();
  db.updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('call-session-store', () => {
  it('a claim needs a ringing call nobody claimed', async () => {
    expect(await claimCall('c1', 'u1')).toBe(true);
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', outcome: 'ringing', answeredByUserId: null }, data: { answeredByUserId: 'u1' } });
    db.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimCall('c1', 'u2')).toBe(false);
  });

  it("only the claimer gives a claim back, and never an answered call's", async () => {
    expect(await releaseClaim('c1', 'u1')).toBe(true);
    expect(db.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', answeredByUserId: 'u1', outcome: { not: 'answered' } }, data: { answeredByUserId: null } });
  });

  it('answering needs the claim and a call still ringing; it closes an open follow-up and returns the fresh row', async () => {
    db.findUnique.mockResolvedValue({ id: 'c1', outcome: 'answered', followUp: 'done' });
    expect(await markAnswered('c1', 'u1', AT)).toEqual({ id: 'c1', outcome: 'answered', followUp: 'done' });
    expect(db.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'c1', outcome: 'ringing', answeredByUserId: 'u1' }, data: { outcome: 'answered', answeredAt: AT } });
    expect(db.updateMany).toHaveBeenNthCalledWith(2, { where: { id: 'c1', followUp: 'open' }, data: { followUp: 'done' } });
    db.updateMany.mockReset().mockResolvedValue({ count: 0 });
    expect(await markAnswered('c1', 'u1', AT)).toBeNull();
    expect(db.updateMany).toHaveBeenCalledTimes(1); // the follow-up is left alone
  });

  it('an end stores who, why and the talk time from the answer, once', async () => {
    db.findUnique.mockResolvedValue(ANSWERED);
    expect(await markEnded('c1', 'agent', 'hangup', AT)).toMatchObject({ endedAt: AT, endedBy: 'agent', endReason: 'hangup', talkSeconds: 90 });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', outcome: 'answered', endedAt: null },
      data: { endedAt: AT, endedBy: 'agent', endReason: 'hangup', talkSeconds: 90 },
    });
    db.findUnique.mockResolvedValue({ ...ANSWERED, endedAt: AT });
    expect(await markEnded('c1', 'caller', 'caller_hangup', AT)).toBeNull(); // already ended
    db.findUnique.mockResolvedValue({ id: 'c1', outcome: 'missed', answeredAt: null, endedAt: null });
    expect(await markEnded('c1', 'agent', 'hangup', AT)).toBeNull(); // never answered
    db.findUnique.mockResolvedValue(ANSWERED);
    db.updateMany.mockResolvedValue({ count: 0 });
    expect(await markEnded('c1', 'caller', 'caller_hangup', AT)).toBeNull(); // read as open, but another end won the write
  });

  it("boot: ends the previous process's answered calls (server_restart) and lets its claims go", async () => {
    db.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    db.findUnique.mockImplementation(async ({ where }: any) => ({ ...ANSWERED, id: where.id }));
    db.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.answeredByUserId ? 3 : 1 }));
    expect(await reconcileAfterRestart(AT)).toEqual({ ended: 2, released: 3 });
    expect(db.findMany).toHaveBeenCalledWith({ where: { outcome: 'answered', endedAt: null }, select: { id: true } });
    expect(db.updateMany).toHaveBeenCalledWith({ where: { answeredByUserId: { not: null }, outcome: { not: 'answered' } }, data: { answeredByUserId: null } });
  });

  it('reads a call with its profile settings, organization and caller name', async () => {
    db.findUnique.mockResolvedValue({
      id: 'c1', outcome: 'ringing',
      profile: { id: 'p1', displayName: 'Line 1', settings: { callsAnswerInDashboard: true }, workspace: { organizationId: 'o1' } },
      conversation: { name: 'Budi' },
    });
    expect(await findCallForAnswer('c1')).toEqual({
      call: { id: 'c1', outcome: 'ringing' },
      profile: { id: 'p1', displayName: 'Line 1', settings: { callsAnswerInDashboard: true }, organizationId: 'o1' },
      callerName: 'Budi',
    });
    db.findUnique.mockResolvedValue(null);
    expect(await findCallForAnswer('nope')).toBeNull();
  });
});

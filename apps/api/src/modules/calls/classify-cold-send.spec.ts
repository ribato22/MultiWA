// classifyColdSend: a send is `service` (not cold) when the recipient messaged us OR
// called us within serviceWindowHours (owner decision D6).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    conversation: { findMany: vi.fn() },
    message: { findFirst: vi.fn() },
    call: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { classifyColdSend } from '@multiwa/engine-runtime';

const db = prisma as any;
const NOW = new Date('2026-10-26T03:00:00.000Z');
const TO = '628111000111@s.whatsapp.net';

beforeEach(() => {
  db.conversation.findMany.mockReset().mockResolvedValue([{ jid: TO, metadata: { lidJid: '1234567@lid' } }]);
  db.message.findFirst.mockReset().mockResolvedValue(null);
  db.call.findFirst.mockReset().mockResolvedValue(null);
});

describe('classifyColdSend', () => {
  it('is cold with no inbound message and no call', async () => {
    await expect(classifyColdSend('p1', TO, 24, NOW)).resolves.toBe(true);
  });

  it('is service after an inbound message in the window (no call lookup)', async () => {
    db.message.findFirst.mockResolvedValue({ timestamp: new Date(NOW.getTime() - 3600_000) });
    await expect(classifyColdSend('p1', TO, 24, NOW)).resolves.toBe(false);
    expect(db.call.findFirst).not.toHaveBeenCalled();
  });

  it('is service after an incoming call in the window, matched on every linked JID', async () => {
    db.call.findFirst.mockResolvedValue({ id: 'c1' });
    await expect(classifyColdSend('p1', TO, 24, NOW)).resolves.toBe(false);
    expect(db.call.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', direction: 'incoming', fromJid: { in: [TO, '1234567@lid'] }, startedAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } },
      select: { id: true },
    });
  });

  it('stays cold when the message is older than the window and there is no call', async () => {
    db.message.findFirst.mockResolvedValue({ timestamp: new Date(NOW.getTime() - 48 * 3600_000) });
    await expect(classifyColdSend('p1', TO, 24, NOW)).resolves.toBe(true);
  });

  it('a failing call lookup (e.g. the calls table is missing) never breaks the send: it classifies as before', async () => {
    db.call.findFirst.mockRejectedValue(new Error('relation "calls" does not exist'));
    await expect(classifyColdSend('p1', TO, 24, NOW)).resolves.toBe(true);
  });

  it('groups are never cold', async () => {
    await expect(classifyColdSend('p1', '1203630000@g.us', 24, NOW)).resolves.toBe(false);
  });
});

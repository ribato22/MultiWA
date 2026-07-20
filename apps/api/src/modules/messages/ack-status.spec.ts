// Regression test for the shared ack update — locks the production fix: an ack
// with no resolvable id must NEVER reach updateMany (which would become WHERE 1=1
// and rewrite every message's status + deadlock). Prisma is mocked (no DB).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    message: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { applyAckStatusUpdate } from '@multiwa/engine-runtime';

describe('applyAckStatusUpdate', () => {
  beforeEach(() => {
    vi.mocked(prisma.message.findFirst).mockReset();
    vi.mocked(prisma.message.updateMany).mockReset();
  });

  it('returns null and touches NO rows when the ack id is undefined (never WHERE 1=1)', async () => {
    const result = await applyAckStatusUpdate(undefined, 'delivered');
    expect(result).toBeNull();
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });

  it('returns null for an empty-string id (also guarded)', async () => {
    expect(await applyAckStatusUpdate('', 'read')).toBeNull();
    expect(prisma.message.updateMany).not.toHaveBeenCalled();
  });

  it('updates by the exact messageId and returns prior + count', async () => {
    vi.mocked(prisma.message.findFirst).mockResolvedValueOnce({ status: 'sent', lane: 'cold' } as any);
    vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 } as any);

    const result = await applyAckStatusUpdate('WA_MSG_123', 'delivered');

    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'WA_MSG_123' },
      data: { status: 'delivered' },
    });
    expect(result).toEqual({ prior: { status: 'sent', lane: 'cold' }, count: 1 });
  });
});

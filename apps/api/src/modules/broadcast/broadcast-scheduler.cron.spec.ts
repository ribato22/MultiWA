// BroadcastSchedulerCron Unit Tests
// The cron only discovers due broadcasts and delegates each to startScheduled();
// the atomic claim (single-winner) lives in BroadcastService and is tested there.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    broadcast: { findMany: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { BroadcastSchedulerCron } from './broadcast-scheduler.cron';

describe('BroadcastSchedulerCron', () => {
  let cron: BroadcastSchedulerCron;
  let broadcastService: { startScheduled: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    broadcastService = { startScheduled: vi.fn().mockResolvedValue(undefined) };
    cron = new BroadcastSchedulerCron(broadcastService as any);
  });

  it('queries only scheduled, due broadcasts and launches each', async () => {
    vi.mocked(prisma.broadcast.findMany).mockResolvedValueOnce([
      { id: 'b1' },
      { id: 'b2' },
    ] as any);

    await cron.processScheduledBroadcasts();

    const where = (vi.mocked(prisma.broadcast.findMany).mock.calls[0][0] as any).where;
    expect(where.status).toBe('scheduled');
    expect(where.scheduledAt.lte).toBeInstanceOf(Date);
    expect(broadcastService.startScheduled).toHaveBeenCalledTimes(2);
    expect(broadcastService.startScheduled).toHaveBeenCalledWith('b1');
    expect(broadcastService.startScheduled).toHaveBeenCalledWith('b2');
  });

  it('does nothing when there are no due broadcasts', async () => {
    vi.mocked(prisma.broadcast.findMany).mockResolvedValueOnce([] as any);

    await cron.processScheduledBroadcasts();

    expect(broadcastService.startScheduled).not.toHaveBeenCalled();
  });

  it('keeps going when one broadcast fails to launch', async () => {
    vi.mocked(prisma.broadcast.findMany).mockResolvedValueOnce([
      { id: 'b1' },
      { id: 'b2' },
    ] as any);
    broadcastService.startScheduled
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(cron.processScheduledBroadcasts()).resolves.toBeUndefined();
    expect(broadcastService.startScheduled).toHaveBeenCalledTimes(2); // b2 still attempted
  });

  it('never throws when the discovery query fails', async () => {
    vi.mocked(prisma.broadcast.findMany).mockRejectedValueOnce(new Error('db down'));

    await expect(cron.processScheduledBroadcasts()).resolves.toBeUndefined();
  });
});

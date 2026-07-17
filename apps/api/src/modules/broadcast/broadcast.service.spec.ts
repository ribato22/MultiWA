// BroadcastService Unit Tests
// Covers durable execution: boot crash-recovery, at-most-once cursor advance,
// resume-from-cursor, and pause/stop handling. Pacing delays are stubbed so the
// loop runs instantly and deterministically.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    broadcast: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    contact: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { BroadcastService } from './broadcast.service';

const messagesMock = () => ({
  sendText: vi.fn().mockResolvedValue({}),
  sendImage: vi.fn().mockResolvedValue({}),
  sendVideo: vi.fn().mockResolvedValue({}),
  sendAudio: vi.fn().mockResolvedValue({}),
  sendDocument: vi.fn().mockResolvedValue({}),
});

describe('BroadcastService (durable execution)', () => {
  let service: BroadcastService;
  let msg: ReturnType<typeof messagesMock>;

  beforeEach(() => {
    vi.resetAllMocks();
    msg = messagesMock();
    service = new BroadcastService(msg as any);
    // Neutralize anti-ban pacing delays so the loop runs instantly in tests.
    vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
    vi.mocked(prisma.broadcast.update).mockResolvedValue({} as any);
  });

  const updateData = () =>
    vi.mocked(prisma.broadcast.update).mock.calls.map((c: any) => c[0].data);

  describe('onModuleInit (crash recovery)', () => {
    it('re-launches every broadcast left running after a restart', async () => {
      vi.mocked(prisma.broadcast.findMany).mockResolvedValueOnce([
        { id: 'b1', profileId: 'p1', cursor: 3 },
        { id: 'b2', profileId: 'p1', cursor: 0 },
      ] as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.onModuleInit();

      expect(vi.mocked(prisma.broadcast.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'running' } }),
      );
      expect(launch).toHaveBeenCalledTimes(2);
      expect(launch).toHaveBeenCalledWith('b1');
      expect(launch).toHaveBeenCalledWith('b2');
    });

    it('does nothing when there are no orphaned broadcasts', async () => {
      vi.mocked(prisma.broadcast.findMany).mockResolvedValueOnce([] as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.onModuleInit();

      expect(launch).not.toHaveBeenCalled();
    });

    it('never throws when the recovery query fails (must not crash boot)', async () => {
      vi.mocked(prisma.broadcast.findMany).mockRejectedValueOnce(new Error('db down'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('start', () => {
    it('snapshots resolved recipients and resets the cursor before launching', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'draft',
        recipients: { type: 'contacts', value: ['628111', '628222'] },
        message: { type: 'text', text: 'hi' },
        settings: {},
        stats: {},
        startedAt: null,
      } as any);
      // No contact matches the ids → resolveRecipients treats values as raw phones.
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      const res = await service.start('b1');

      const data = updateData()[0];
      expect(data.status).toBe('running');
      expect(data.cursor).toBe(0);
      expect(data.resolvedRecipients).toEqual(['628111', '628222']);
      expect(data.stats.total).toBe(2);
      expect(launch).toHaveBeenCalledWith('b1');
      expect(res.recipientCount).toBe(2);
    });

    it('rejects when no recipients resolve', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'draft',
        recipients: { type: 'all', value: [] },
        message: {},
        settings: {},
        stats: {},
      } as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);

      await expect(service.start('b1')).rejects.toThrow(/No recipients/);
    });
  });

  describe('runExecution', () => {
    const runningBroadcast = (over: any = {}) => ({
      id: 'b1',
      profileId: 'p1',
      status: 'running',
      message: { type: 'text', text: 'hi' },
      settings: { delayMin: 0, delayMax: 0, batchSize: 1000, retryFailed: false },
      resolvedRecipients: ['628111', '628222'],
      cursor: 0,
      stats: { total: 2, sent: 0, failed: 0 },
      ...over,
    });

    it('advances the cursor BEFORE sending each recipient (at-most-once)', async () => {
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(runningBroadcast() as any) // initial load
        .mockResolvedValue({ status: 'running' } as any); // status polls

      await (service as any).runExecution('b1');

      // The first DB write (cursor := 1) must happen before the first send.
      expect(vi.mocked(prisma.broadcast.update).mock.invocationCallOrder[0]).toBeLessThan(
        msg.sendText.mock.invocationCallOrder[0],
      );

      expect(msg.sendText).toHaveBeenCalledTimes(2);
      expect(msg.sendText.mock.calls[0][0].to).toBe('628111');
      expect(msg.sendText.mock.calls[1][0].to).toBe('628222');

      const data = updateData();
      expect(data.some((d: any) => d.cursor === 1)).toBe(true);
      expect(data.some((d: any) => d.cursor === 2)).toBe(true);
      const last = data[data.length - 1];
      expect(last.status).toBe('completed');
      expect(last.stats.sent).toBe(2);
    });

    it('resumes from the persisted cursor without re-sending earlier recipients', async () => {
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(
          runningBroadcast({
            resolvedRecipients: ['a', 'b', 'c'],
            cursor: 1,
            stats: { total: 3, sent: 1, failed: 0 },
          }) as any,
        )
        .mockResolvedValue({ status: 'running' } as any);

      await (service as any).runExecution('b1');

      expect(msg.sendText).toHaveBeenCalledTimes(2);
      expect(msg.sendText.mock.calls.map((c: any) => c[0].to)).toEqual(['b', 'c']);
      const last = updateData().pop();
      expect(last.status).toBe('completed');
      expect(last.stats.sent).toBe(3); // seeded 1 + 2 newly sent
    });

    it('stops immediately when the broadcast is no longer running (paused/cancelled)', async () => {
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(runningBroadcast({ resolvedRecipients: ['a', 'b', 'c'] }) as any)
        .mockResolvedValueOnce({ status: 'paused' } as any); // first poll → paused

      await (service as any).runExecution('b1');

      expect(msg.sendText).not.toHaveBeenCalled();
      expect(updateData().some((d: any) => d.status === 'completed')).toBe(false);
    });

    it('does not execute a broadcast whose status is not running', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        status: 'completed',
      } as any);

      await (service as any).runExecution('b1');

      expect(msg.sendText).not.toHaveBeenCalled();
      expect(prisma.broadcast.update).not.toHaveBeenCalled();
    });

    it('counts a permanently failing recipient as failed and moves on (no retry)', async () => {
      msg.sendText.mockRejectedValue(new Error('engine down'));
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(runningBroadcast({ resolvedRecipients: ['a'] }) as any)
        .mockResolvedValue({ status: 'running' } as any);

      await (service as any).runExecution('b1');

      const last = updateData().pop();
      expect(last.status).toBe('completed');
      expect(last.stats.sent).toBe(0);
      expect(last.stats.failed).toBe(1);
    });
  });

  describe('resume', () => {
    it('flips a paused broadcast back to running and relaunches from its cursor', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'paused',
        resolvedRecipients: ['a', 'b'],
        cursor: 1,
        stats: { sent: 1 },
      } as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      const res = await service.resume('b1');

      expect(prisma.contact.findMany).not.toHaveBeenCalled(); // no fragile re-resolve
      expect(updateData()[0]).toEqual({ status: 'running' });
      expect(launch).toHaveBeenCalledWith('b1');
      expect(res.success).toBe(true);
    });

    it('restarts a legacy paused broadcast that has no recipient snapshot', async () => {
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce({ id: 'b1', status: 'paused', resolvedRecipients: null } as any) // resume→findOne
        .mockResolvedValueOnce({
          id: 'b1',
          profileId: 'p1',
          status: 'paused',
          recipients: { type: 'contacts', value: ['x'] },
          message: {},
          settings: {},
          stats: {},
          startedAt: null,
        } as any); // start→findOne
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);
      vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.resume('b1');

      const data = updateData()[0];
      expect(data.resolvedRecipients).toEqual(['x']);
      expect(data.cursor).toBe(0);
    });

    it('rejects resuming a non-paused broadcast', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        status: 'running',
      } as any);

      await expect(service.resume('b1')).rejects.toThrow(/Can only resume paused/);
    });
  });
});

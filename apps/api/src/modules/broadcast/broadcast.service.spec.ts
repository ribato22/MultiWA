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
      updateMany: vi.fn(),
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
    // Default: the atomic status claim succeeds (single winner).
    vi.mocked(prisma.broadcast.updateMany).mockResolvedValue({ count: 1 } as any);
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

      // Transition to running is an atomic compare-and-set claim (status='draft').
      expect(vi.mocked(prisma.broadcast.updateMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'b1', status: 'draft' }),
          data: { status: 'running' },
        }),
      );
      // The snapshot write carries the recipient list + cursor (status set by the claim).
      const data = updateData()[0];
      expect(data.cursor).toBe(0);
      expect(data.resolvedRecipients).toEqual(['628111', '628222']);
      expect(data.stats.total).toBe(2);
      expect(launch).toHaveBeenCalledWith('b1');
      expect(res.recipientCount).toBe(2);
    });

    it('rejects and does not launch when the claim is lost to a concurrent starter', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'scheduled',
        recipients: { type: 'contacts', value: ['x'] },
        message: {},
        settings: {},
        stats: {},
      } as any);
      vi.mocked(prisma.broadcast.updateMany).mockResolvedValueOnce({ count: 0 } as any); // lost race
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await expect(service.start('b1')).rejects.toThrow(/state changed/);
      expect(launch).not.toHaveBeenCalled();
      expect(prisma.contact.findMany).not.toHaveBeenCalled(); // never resolved recipients
    });

    it('continues (never restarts) a paused, partially-sent broadcast', async () => {
      // start() on a paused broadcast must behave like resume — it must NOT reset the
      // cursor/stats to 0, which would re-send everyone already contacted.
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValue({
        id: 'b1',
        profileId: 'p1',
        status: 'paused',
        resolvedRecipients: ['a', 'b', 'c'],
        cursor: 2,
        stats: { sent: 2, total: 3 },
      } as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.start('b1');

      expect(vi.mocked(prisma.broadcast.updateMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1', status: 'paused' },
          data: { status: 'running' },
        }),
      );
      expect(updateData().some((d: any) => d.cursor === 0)).toBe(false); // no reset
      expect(prisma.contact.findMany).not.toHaveBeenCalled(); // no re-resolve
      expect(launch).toHaveBeenCalledWith('b1');
    });

    it('rejects and reverts the claim when no recipients resolve', async () => {
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
      // Claim is undone → status reverted to the prior value.
      expect(updateData().some((d: any) => d.status === 'draft')).toBe(true);
    });

    it('reverts the claim to the prior status if launch throws after claiming (no stranded running)', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'scheduled',
        recipients: { type: 'all', value: [] },
        message: {},
        settings: {},
        stats: {},
      } as any);
      // Claim succeeds, then prepareAndLaunch's recipient query fails transiently.
      vi.mocked(prisma.contact.findMany).mockRejectedValueOnce(new Error('db blip'));

      await expect(service.start('b1')).rejects.toThrow(/db blip/);
      // Rolled back to 'scheduled' rather than left stranded in 'running'.
      expect(updateData().some((d: any) => d.status === 'scheduled')).toBe(true);
    });
  });

  describe('update', () => {
    it('ignores execution-state fields in the body (mass-assignment guard)', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({ id: 'b1', status: 'draft' } as any);

      await service.update('b1', {
        name: 'new name',
        // Hostile extras that map to real columns — must be dropped:
        status: 'running',
        cursor: 0,
        resolvedRecipients: null,
        stats: { sent: 0 },
      } as any);

      const data = updateData()[0];
      expect(data).toEqual({ name: 'new name' }); // only the whitelisted field is written
      expect('status' in data).toBe(false);
      expect('cursor' in data).toBe(false);
      expect('resolvedRecipients' in data).toBe(false);
    });

    it('refuses to edit a non-draft broadcast', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({ id: 'b1', status: 'completed' } as any);

      await expect(service.update('b1', { name: 'x' } as any)).rejects.toThrow(/draft/);
    });
  });

  describe('startScheduled (scheduler cron entry point)', () => {
    it('atomically claims a due broadcast and launches it', async () => {
      vi.mocked(prisma.broadcast.updateMany).mockResolvedValueOnce({ count: 1 } as any); // won the claim
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'running',
        recipients: { type: 'contacts', value: ['628111'] },
        message: { type: 'text', text: 'hi' },
        settings: {},
        stats: {},
        startedAt: null,
      } as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.startScheduled('b1');

      const claim = vi.mocked(prisma.broadcast.updateMany).mock.calls[0][0] as any;
      expect(claim.where).toMatchObject({ id: 'b1', status: 'scheduled' });
      expect(claim.where.scheduledAt.lte).toBeInstanceOf(Date); // due-check is part of the claim
      expect(claim.data).toEqual({ status: 'running' });
      expect(updateData()[0].resolvedRecipients).toEqual(['628111']);
      expect(launch).toHaveBeenCalledWith('b1');
    });

    it('does nothing when the atomic claim is lost (another tick / not due)', async () => {
      vi.mocked(prisma.broadcast.updateMany).mockResolvedValueOnce({ count: 0 } as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.startScheduled('b1');

      expect(prisma.broadcast.findUnique).not.toHaveBeenCalled(); // never proceeded past the claim
      expect(launch).not.toHaveBeenCalled();
    });

    it('marks a claimed-but-empty scheduled broadcast as failed (no infinite re-pick)', async () => {
      vi.mocked(prisma.broadcast.updateMany).mockResolvedValueOnce({ count: 1 } as any);
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'running',
        recipients: { type: 'all', value: [] },
        message: {},
        settings: {},
        stats: {},
      } as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.startScheduled('b1');

      expect(launch).not.toHaveBeenCalled();
      expect(updateData().some((d: any) => d.status === 'failed')).toBe(true);
    });
  });

  describe('schedule', () => {
    it('rejects scheduling a non-draft (paused) broadcast — prevents cron double-send', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        status: 'paused',
        resolvedRecipients: ['a', 'b'],
        cursor: 1,
      } as any);

      await expect(
        service.schedule('b1', {
          scheduledAt: new Date(Date.now() + 60_000).toISOString(),
        } as any),
      ).rejects.toThrow(/Only draft broadcasts/);
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

    // Recovery of a 'running' row with no recipient snapshot: crash between the atomic
    // claim and the snapshot write, or a legacy pre-durable broadcast.
    it('recovers a snapshotless running broadcast that has sent nothing by resolving fresh', async () => {
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(
          runningBroadcast({
            recipients: { type: 'contacts', value: ['628999'] },
            resolvedRecipients: null,
            cursor: 0,
            stats: { sent: 0, failed: 0 },
          }) as any,
        )
        .mockResolvedValue({ status: 'running' } as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any); // value treated as raw phones

      await (service as any).runExecution('b1');

      // The snapshot is written during recovery, then the recipient is sent exactly once.
      expect(
        updateData().some(
          (d: any) => Array.isArray(d.resolvedRecipients) && d.resolvedRecipients[0] === '628999',
        ),
      ).toBe(true);
      expect(msg.sendText).toHaveBeenCalledTimes(1);
      expect(msg.sendText.mock.calls[0][0].to).toBe('628999');
    });

    it('a superseded run exits immediately without sending (run-token guard)', async () => {
      // The current active run for b1 is 99; this stale loop carries token 1
      // (models a pause→resume that spawned a newer loop while this one was in delay()).
      (service as any).activeRun.set('b1', 99);
      vi.mocked(prisma.broadcast.findUnique)
        .mockResolvedValueOnce(runningBroadcast() as any)
        .mockResolvedValue({ status: 'running' } as any);

      await (service as any).runExecution('b1', 1);

      expect(msg.sendText).not.toHaveBeenCalled();
      expect(prisma.broadcast.update).not.toHaveBeenCalled(); // no cursor advance, no completion
    });

    it('fails a snapshotless running broadcast that already sent some (never re-sends them)', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce(
        runningBroadcast({
          recipients: { type: 'all', value: [] },
          resolvedRecipients: null,
          cursor: 3,
          stats: { sent: 3, failed: 0 },
        }) as any,
      );

      await (service as any).runExecution('b1');

      expect(msg.sendText).not.toHaveBeenCalled();
      expect(updateData().some((d: any) => d.status === 'failed')).toBe(true);
    });
  });

  describe('resume', () => {
    it('atomically claims paused → running and relaunches from its cursor', async () => {
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

      // Single-winner compare-and-set, not a plain read-then-write.
      expect(vi.mocked(prisma.broadcast.updateMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'b1', status: 'paused' },
          data: { status: 'running' },
        }),
      );
      expect(prisma.contact.findMany).not.toHaveBeenCalled(); // no fragile re-resolve
      expect(launch).toHaveBeenCalledWith('b1');
      expect(res.success).toBe(true);
    });

    it('rejects a concurrent resume that loses the atomic claim (no double launch)', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'paused',
        resolvedRecipients: ['a', 'b'],
        cursor: 1,
        stats: { sent: 1 },
      } as any);
      vi.mocked(prisma.broadcast.updateMany).mockResolvedValueOnce({ count: 0 } as any); // lost the race
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await expect(service.resume('b1')).rejects.toThrow(/state changed/);
      expect(launch).not.toHaveBeenCalled();
    });

    it('starts a legacy paused broadcast (no snapshot) that never sent anything', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'paused',
        resolvedRecipients: null,
        recipients: { type: 'contacts', value: ['x'] },
        message: {},
        settings: {},
        stats: { sent: 0 },
        startedAt: null,
      } as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([] as any);
      vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await service.resume('b1');

      const data = updateData()[0];
      expect(data.resolvedRecipients).toEqual(['x']);
      expect(data.cursor).toBe(0);
    });

    it('refuses to resume a legacy paused broadcast that already sent some (anti double-send)', async () => {
      vi.mocked(prisma.broadcast.findUnique).mockResolvedValueOnce({
        id: 'b1',
        profileId: 'p1',
        status: 'paused',
        resolvedRecipients: null,
        stats: { sent: 12 },
      } as any);
      const launch = vi.spyOn(service as any, 'launchExecution').mockImplementation(() => {});

      await expect(service.resume('b1')).rejects.toThrow(/cannot be safely resumed/);
      expect(launch).not.toHaveBeenCalled();
      expect(prisma.broadcast.updateMany).not.toHaveBeenCalled(); // never even claimed
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

// SendGateService unit tests
// Proves per-profile serialization, the daily-limit 429, null=unlimited, and
// that a failed/429 send does NOT wedge the per-profile queue (chain poisoning).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { SendGateService, nextMidnightWIB } from './send-gate.service';

const FUTURE = new Date(Date.now() + 60 * 60 * 1000); // avoids the lazy-reset path

function profileRow(over: Partial<any> = {}) {
  return {
    messageDelayMs: 0,
    dailyMessageLimit: null,
    dailyMessageCount: 0,
    dailyResetAt: FUTURE,
    ...over,
  };
}

describe('SendGateService', () => {
  let gate: SendGateService;

  beforeEach(() => {
    vi.mocked(prisma.profile.findUnique).mockReset();
    vi.mocked(prisma.profile.update).mockReset().mockResolvedValue({} as any);
    gate = new SendGateService();
  });

  it('serializes sends for the same profile (no overlap)', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(profileRow() as any);

    let active = 0;
    let maxActive = 0;
    const sendFn = () =>
      new Promise<string>((resolve) => {
        active++;
        maxActive = Math.max(maxActive, active);
        setTimeout(() => {
          active--;
          resolve('ok');
        }, 20);
      });

    await Promise.all([
      gate.executeWithGate('p1', sendFn),
      gate.executeWithGate('p1', sendFn),
      gate.executeWithGate('p1', sendFn),
    ]);

    expect(maxActive).toBe(1); // never two sends in flight for one profile
  });

  it('rejects with 429 once the daily limit is reached, without calling sendFn', async () => {
    let count = 0;
    vi.mocked(prisma.profile.findUnique).mockImplementation(
      async () => profileRow({ dailyMessageLimit: 2, dailyMessageCount: count }) as any,
    );
    vi.mocked(prisma.profile.update).mockImplementation(async (args: any) => {
      if (args?.data?.dailyMessageCount?.increment) count += 1;
      return {} as any;
    });

    const sendFn = vi.fn().mockResolvedValue('ok');

    await expect(gate.executeWithGate('p1', sendFn)).resolves.toBe('ok'); // count 0 -> 1
    await expect(gate.executeWithGate('p1', sendFn)).resolves.toBe('ok'); // count 1 -> 2
    await expect(gate.executeWithGate('p1', sendFn)).rejects.toBeInstanceOf(HttpException); // count 2 >= 2

    expect(sendFn).toHaveBeenCalledTimes(2); // third never sent
  });

  it('never throws 429 when the limit is null (unlimited)', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(
      profileRow({ dailyMessageLimit: null, dailyMessageCount: 9999 }) as any,
    );
    const sendFn = vi.fn().mockResolvedValue('ok');
    await expect(gate.executeWithGate('p1', sendFn)).resolves.toBe('ok');
    expect(sendFn).toHaveBeenCalled();
  });

  it('does not wedge the per-profile chain after a send failure', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(profileRow() as any);

    await expect(
      gate.executeWithGate('p1', () => Promise.reject(new Error('engine boom'))),
    ).rejects.toThrow('engine boom');

    // The next send for the SAME profile must still run.
    const ok = vi.fn().mockResolvedValue('recovered');
    await expect(gate.executeWithGate('p1', ok)).resolves.toBe('recovered');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('does not wedge the chain after a 429', async () => {
    vi.mocked(prisma.profile.findUnique)
      .mockResolvedValueOnce(profileRow({ dailyMessageLimit: 1, dailyMessageCount: 1 }) as any) // 429
      .mockResolvedValue(profileRow() as any); // subsequent: unlimited

    await expect(gate.executeWithGate('p1', vi.fn())).rejects.toBeInstanceOf(HttpException);

    const ok = vi.fn().mockResolvedValue('ok');
    await expect(gate.executeWithGate('p1', ok)).resolves.toBe('ok');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('nextMidnightWIB', () => {
  it('returns the next 00:00 Asia/Jakarta as a UTC instant', () => {
    // 2026-06-16T05:00:00Z = 12:00 WIB → next WIB midnight = 2026-06-17T00:00 WIB = 2026-06-16T17:00:00Z
    const out = nextMidnightWIB(new Date('2026-06-16T05:00:00.000Z'));
    expect(out.toISOString()).toBe('2026-06-16T17:00:00.000Z');
  });

  it('rolls to the following day when already past WIB midnight boundary', () => {
    // 2026-06-16T18:00:00Z = 2026-06-17T01:00 WIB → next WIB midnight = 2026-06-18T00:00 WIB = 2026-06-17T17:00:00Z
    const out = nextMidnightWIB(new Date('2026-06-16T18:00:00.000Z'));
    expect(out.toISOString()).toBe('2026-06-17T17:00:00.000Z');
  });
});

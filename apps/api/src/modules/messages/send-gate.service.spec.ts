// SendGateService unit tests
// Proves per-profile serialization, the daily-limit 429, null=unlimited, that a
// failed/429 send does NOT wedge the per-profile queue (chain poisoning), and that
// a send that never settles does not either (504 SEND_TIMEOUT).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { SendGateService, nextMidnightWIB, SEND_TIMEOUT_MS } from '@multiwa/engine-runtime';

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
      (async () => profileRow({ dailyMessageLimit: 2, dailyMessageCount: count })) as any,
    );
    vi.mocked(prisma.profile.update).mockImplementation((async (args: any) => {
      if (args?.data?.dailyMessageCount?.increment) count += 1;
      return {};
    }) as any);

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

  it('does not count a send the engine reports as failed', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(profileRow() as any);
    const failed = { success: false, error: 'Client not ready' };

    await expect(gate.executeWithGate('p1', async () => failed)).resolves.toBe(failed);

    expect(prisma.profile.update).not.toHaveBeenCalled(); // nothing went out
  });
});

// 2026-11-01: a profile's send chain stopped moving: every later send waited behind a
// stuck one, and 2,493 messages sat `pending` until a restart.
describe('SendGateService send timeout', () => {
  let gate: SendGateService;
  const increments = () =>
    vi.mocked(prisma.profile.update).mock.calls.filter(([a]: any[]) => a?.data?.dailyMessageCount?.increment === 1).length;
  /** Starts a send that settles only when the test says so, and records how the gate answered. */
  const startSend = () => {
    const send: { outcome: unknown; finish: (r: unknown) => void; fail: (e: Error) => void } = {
      outcome: 'pending',
      finish: () => {},
      fail: () => {},
    };
    gate
      .executeWithGate('p1', () => new Promise((resolve, reject) => ((send.finish = resolve), (send.fail = reject))))
      .then(
        () => (send.outcome = 'resolved'),
        (e) => (send.outcome = e),
      );
    return send;
  };
  const expectTimedOut = (outcome: unknown) => {
    expect(outcome).toBeInstanceOf(HttpException);
    expect((outcome as HttpException).getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect((outcome as HttpException).getResponse()).toMatchObject({ error: 'SEND_TIMEOUT' });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(prisma.profile.findUnique).mockReset().mockResolvedValue(profileRow() as any);
    vi.mocked(prisma.profile.update).mockReset().mockResolvedValue({} as any);
    gate = new SendGateService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails a send that never settles with 504 SEND_TIMEOUT and frees the profile', async () => {
    const send = startSend();

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);

    expectTimedOut(send.outcome);
    expect(increments()).toBe(0); // it did not go out, so it does not count
    // The next send of the same profile is no longer stuck behind it.
    await expect(gate.executeWithGate('p1', async () => 'next')).resolves.toBe('next');
  });

  it('counts a timed-out send once it does finish, as it went out after all', async () => {
    const send = startSend();
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expectTimedOut(send.outcome);
    expect(increments()).toBe(0);

    send.finish({ success: true, messageId: 'wa-late' });
    await vi.advanceTimersByTimeAsync(0);

    expect(increments()).toBe(1);
  });

  it('does not count a timed-out send that finishes as an engine failure', async () => {
    const send = startSend();
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expectTimedOut(send.outcome);

    send.finish({ success: false, error: 'Runtime.callFunctionOn timed out' });
    await vi.advanceTimersByTimeAsync(0);

    expect(increments()).toBe(0);
  });

  it('ignores a timed-out send that later throws (no count, no unhandled rejection)', async () => {
    const send = startSend();
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expectTimedOut(send.outcome);

    send.fail(new Error('Protocol error: Target closed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(increments()).toBe(0);
  });

  it('leaves no timer behind a send that finished in time', async () => {
    await expect(gate.executeWithGate('p1', async () => ({ success: true }))).resolves.toEqual({ success: true });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(increments()).toBe(1); // counted once, never again by a stale timer
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

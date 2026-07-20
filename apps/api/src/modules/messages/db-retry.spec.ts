// Tests for the Postgres write-conflict / deadlock retry that wraps the hot-row
// ack update. Locks: retry only on transient conflicts, bounded attempts, original
// error rethrown, and no real backoff delay (injected sleep).
import { describe, it, expect, vi } from 'vitest';
import { withDeadlockRetry, isRetryableDbError } from '@multiwa/engine-runtime';

const noSleep = () => Promise.resolve();

describe('isRetryableDbError', () => {
  it('recognizes Prisma + Postgres conflict codes (direct, nested, and message)', () => {
    expect(isRetryableDbError({ code: 'P2034' })).toBe(true);
    expect(isRetryableDbError({ code: '40P01' })).toBe(true);
    expect(isRetryableDbError({ code: '40001' })).toBe(true);
    expect(isRetryableDbError({ code: '55P03' })).toBe(true);
    expect(isRetryableDbError({ cause: { code: '40P01' } })).toBe(true);
    expect(isRetryableDbError({ message: 'deadlock detected' })).toBe(true);
    expect(isRetryableDbError({ message: 'could not serialize access' })).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isRetryableDbError({ code: 'P2002' })).toBe(false); // unique constraint
    expect(isRetryableDbError({ message: 'connection refused' })).toBe(false);
    expect(isRetryableDbError(null)).toBe(false);
    expect(isRetryableDbError('boom')).toBe(false);
  });
});

describe('withDeadlockRetry', () => {
  it('returns the result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const onRetry = vi.fn();
    await expect(withDeadlockRetry(fn, { sleep: noSleep, onRetry })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries a transient deadlock and eventually succeeds', async () => {
    const err = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const fn = vi.fn().mockRejectedValueOnce(err).mockRejectedValueOnce(err).mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(withDeadlockRetry(fn, { sleep: noSleep, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gives up after `retries` and rethrows the ORIGINAL error', async () => {
    const err = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDeadlockRetry(fn, { retries: 2, sleep: noSleep, onRetry: () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does NOT retry a non-retryable error (rethrows immediately)', async () => {
    const err = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withDeadlockRetry(fn, { sleep: noSleep, onRetry: () => {} })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

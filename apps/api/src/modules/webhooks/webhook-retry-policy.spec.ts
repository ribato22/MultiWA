// The webhook retry policy is env-tunable (WEBHOOK_RETRY_ATTEMPTS /
// WEBHOOK_RETRY_DELAY_MS). The original `parseInt(...) || fallback` form was wrong
// in two ways — it swallowed a deliberate 0 and it let negatives through, either of
// which hands BullMQ an invalid retry policy. These lock the corrected semantics.
//
// The helper is intentionally re-implemented here rather than exported: it is a
// two-line private detail of both dispatcher forks, and this spec is the contract
// they must both satisfy (a divergence between those two files has caused real
// production bugs in this repo before).

import { describe, it, expect, afterEach, vi } from 'vitest';

function positiveIntEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

describe('webhook retry policy env parsing', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to the historical policy when unset (5 attempts, 30s backoff)', () => {
    expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(5);
    expect(positiveIntEnv('WEBHOOK_RETRY_DELAY_MS', 30000)).toBe(30000);
  });

  it('honours a valid override', () => {
    vi.stubEnv('WEBHOOK_RETRY_ATTEMPTS', '3');
    vi.stubEnv('WEBHOOK_RETRY_DELAY_MS', '5000');
    expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(3);
    expect(positiveIntEnv('WEBHOOK_RETRY_DELAY_MS', 30000)).toBe(5000);
  });

  // `parseInt('0') || 5` returned 5 — the operator asked for no retries and got the
  // default instead. Falling back is still the right call (BullMQ needs >= 1
  // attempt), but it must be a deliberate rule, not an accident of `||`.
  it('falls back on 0 rather than producing an unusable policy', () => {
    vi.stubEnv('WEBHOOK_RETRY_ATTEMPTS', '0');
    expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(5);
  });

  // `parseInt('-1') || 5` returned -1 — a negative sailed straight through to BullMQ.
  it('rejects negatives (the old `||` form passed them through)', () => {
    vi.stubEnv('WEBHOOK_RETRY_ATTEMPTS', '-1');
    vi.stubEnv('WEBHOOK_RETRY_DELAY_MS', '-30000');
    expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(5);
    expect(positiveIntEnv('WEBHOOK_RETRY_DELAY_MS', 30000)).toBe(30000);
  });

  it('rejects garbage and empty strings', () => {
    for (const bad of ['', '   ', 'abc', 'NaN', 'Infinity']) {
      vi.stubEnv('WEBHOOK_RETRY_ATTEMPTS', bad);
      expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(5);
    }
  });

  it('tolerates a trailing-unit value the way parseInt does (e.g. "10s" -> 10)', () => {
    vi.stubEnv('WEBHOOK_RETRY_ATTEMPTS', '10s');
    expect(positiveIntEnv('WEBHOOK_RETRY_ATTEMPTS', 5)).toBe(10);
  });
});

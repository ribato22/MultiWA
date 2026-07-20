// MultiWA Gateway - Postgres write-conflict / deadlock retry
// packages/engine-runtime/src/db-retry.ts
//
// The hot-row ack update (applyAckStatusUpdate) contends with concurrent acks for
// the same/overlapping message rows and periodically deadlocks under production
// load (~hundreds/24h were observed, and were invisible to observability). This
// helper retries a Postgres write-conflict/deadlock a few times with exponential
// backoff and logs each retry so the previously-silent conflicts surface.

// Error codes that indicate a *transient* write conflict worth retrying.
const RETRYABLE_DB_CODES = new Set([
  'P2034', // Prisma: "Transaction failed due to a write conflict or a deadlock"
  '40P01', // Postgres: deadlock_detected
  '40001', // Postgres: serialization_failure
  '55P03', // Postgres: lock_not_available
]);

/**
 * True when the error is a transient Postgres write conflict / deadlock that a
 * retry can resolve. Checks the Prisma code, common nested driver-error codes
 * (Prisma 7 driver adapters surface the pg error under `cause`/`meta`), and the
 * message text as a last resort.
 */
export function isRetryableDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as any;
  for (const code of [e.code, e?.meta?.code, e?.cause?.code, e?.originalError?.code]) {
    if (typeof code === 'string' && RETRYABLE_DB_CODES.has(code)) return true;
  }
  return /deadlock detected|could not serialize|write conflict|deadlock/i.test(String(e.message ?? ''));
}

export interface DeadlockRetryOptions {
  /** Max retries AFTER the first attempt (default 3 → up to 4 tries). */
  retries?: number;
  /** Base backoff; grows exponentially per attempt (default 20ms). */
  baseDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook fired before each backoff. Defaults to a warn log. */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function defaultOnRetry(info: { attempt: number; error: unknown; delayMs: number }): void {
  const msg = (info.error as any)?.message ?? String(info.error);
  // Structured, grep-able line ("[db-retry]") so the previously-invisible prod
  // write conflicts become countable in the logs.
  console.warn(`[db-retry] retryable DB conflict (attempt ${info.attempt}, backoff ${info.delayMs}ms): ${msg}`);
}

/**
 * Run `fn`, retrying transient Postgres write conflicts / deadlocks with
 * exponential backoff. Non-retryable errors (and exhausted retries) rethrow the
 * ORIGINAL error unchanged, so callers see the real failure.
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, opts: DeadlockRetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 20;
  const sleep = opts.sleep ?? defaultSleep;
  const onRetry = opts.onRetry ?? defaultOnRetry;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryableDbError(err)) throw err;
      attempt += 1;
      // Exponential backoff with a small attempt-based jitter (deterministic).
      const delayMs = baseDelayMs * 2 ** (attempt - 1) + attempt * 3;
      onRetry({ attempt, error: err, delayMs });
      await sleep(delayMs);
    }
  }
}

// MultiWA Gateway - Deadline for engine work (shared engine runtime)
// packages/engine-runtime/src/with-timeout.ts
//
// Engine calls go through a headless page whose own timeout (puppeteer's protocolTimeout) is
// minutes. Callers that must answer sooner, or must not hold something while the page hangs,
// put their own deadline on top with this.

/**
 * `work`, or a rejection with `message` once `ms` have passed. The work is not cancelled: it
 * runs on, and its outcome is ignored. The timer never outlives the work.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, message = 'ENGINE_TIMEOUT'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// MultiWA Gateway - What to do when a session or its headless browser dies
// packages/engine-runtime/src/engine-lifecycle.ts
//
// Shared by apps/api and apps/worker so both engine hosts react identically.

/**
 * Disconnect reasons that mean the linked device itself is gone: the session must
 * be cleared and re-linked with a fresh QR, not retried. Baileys reports
 * 'Logged Out' / 'Session Expired…'; whatsapp-web.js reports 'LOGOUT' when the
 * phone (or WhatsApp) removes the linked device.
 */
const SESSION_INVALID_REASONS = ['Session Expired', 'Logged Out', 'loggedOut', 'LOGOUT'];

export function isSessionInvalidReason(reason: string): boolean {
  return SESSION_INVALID_REASONS.some((r) => reason.includes(r));
}

/**
 * Errors puppeteer raises when the page or browser disappears mid-call: a logout
 * navigation, a crashed or closed Chromium, or our own destroy() racing a
 * whatsapp-web.js event handler that is still running.
 */
const BROWSER_LIFECYCLE_PATTERNS = [
  /Attempted to use detached Frame/i,
  /Navigating frame was detached/i,
  /Execution context was destroyed/i,
  /Target closed/i,
  /Session closed/i,
  /Connection closed/i,
  /browser has disconnected/i,
];

export function isBrowserLifecycleError(reason: unknown): boolean {
  const message =
    typeof reason === 'string' ? reason : ((reason as { message?: unknown } | null)?.message ?? '');
  return typeof message === 'string' && BROWSER_LIFECYCLE_PATTERNS.some((p) => p.test(message));
}

interface RejectionSource {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/**
 * whatsapp-web.js runs async handlers (e.g. `framenavigated` -> `inject()`) that
 * nothing awaits, so when one profile's browser goes away they reject unhandled
 * and Node's default is to exit — taking every other session down with it.
 * Absorb only that class of error; anything else is rethrown so real bugs still
 * crash loudly, exactly as before.
 */
export function installBrowserRejectionGuard(
  warn: (message: string) => void,
  source: RejectionSource = process,
): void {
  source.on('unhandledRejection', (reason) => {
    if (!isBrowserLifecycleError(reason)) {
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
    const text = reason instanceof Error ? reason.message : String(reason);
    warn(`Ignoring unhandled browser rejection (a profile's browser went away): ${text.slice(0, 200)}`);
  });
}

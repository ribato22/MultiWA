// MultiWA Gateway - Per-profile connect watchdog
// packages/engine-runtime/src/connect-watchdog.ts
//
// A profile that never comes online used to be caught by one timer armed when
// connect() started. That timer cannot tell "stuck" from "a healthy page waiting for
// a human to scan the QR", so it destroyed and re-created a perfectly good QR wait
// every two minutes. This tracks which phase a connect is in and applies only the
// deadline that fits it. Shared by apps/api and apps/worker.

/** Phases in which a missed deadline means the engine is stuck. */
export type StuckPhase = 'starting' | 'authenticated';
export type WatchdogPhase = StuckPhase | 'waiting-for-scan';

export interface ConnectWatchdogOptions {
  /** connect() began: the page must show a QR or authenticate within this long. */
  startMs: number;
  /** Authenticated: 'ready' must follow within this long (whatsapp-web.js ready-hang). */
  readyMs: number;
  /** A QR is showing: how long it may sit unscanned before the engine is stopped. */
  qrWaitMs: number;
  /** startMs or readyMs elapsed without progress. */
  onStuck: (profileId: string, phase: StuckPhase) => void;
  /** qrWaitMs elapsed: nobody scanned. Not a failure. */
  onQrWaitExpired: (profileId: string) => void;
}

export class ConnectWatchdog {
  private readonly entries = new Map<string, { phase: WatchdogPhase; timer: NodeJS.Timeout }>();

  constructor(private readonly options: ConnectWatchdogOptions) {}

  /** connect() has started. Also restarts the clock on a re-connect. */
  start(profileId: string): void {
    this.arm(profileId, 'starting', this.options.startMs);
  }

  /**
   * A QR was issued: the page loaded and WhatsApp is waiting for a human. Only the
   * first QR counts; refreshes arrive every ~20 s and must not extend the wait.
   */
  qrIssued(profileId: string): void {
    if (this.phaseOf(profileId) !== 'starting') return;
    this.arm(profileId, 'waiting-for-scan', this.options.qrWaitMs);
  }

  /** The QR was scanned (or a stored session was accepted): 'ready' must follow soon. */
  authenticated(profileId: string): void {
    if (!this.entries.has(profileId)) return;
    this.arm(profileId, 'authenticated', this.options.readyMs);
  }

  /** The profile reached 'ready', disconnected, or was disconnected on purpose. */
  clear(profileId: string): void {
    const entry = this.entries.get(profileId);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(profileId);
    }
  }

  clearAll(): void {
    for (const profileId of Array.from(this.entries.keys())) this.clear(profileId);
  }

  phaseOf(profileId: string): WatchdogPhase | undefined {
    return this.entries.get(profileId)?.phase;
  }

  private arm(profileId: string, phase: WatchdogPhase, ms: number): void {
    this.clear(profileId);
    const timer = setTimeout(() => {
      this.entries.delete(profileId);
      if (phase === 'waiting-for-scan') this.options.onQrWaitExpired(profileId);
      else this.options.onStuck(profileId, phase);
    }, ms);
    this.entries.set(profileId, { phase, timer });
  }
}

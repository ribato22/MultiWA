import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConnectWatchdog } from '@multiwa/engine-runtime';

const START_MS = 120_000;
const READY_MS = 60_000;
const QR_WAIT_MS = 600_000;

describe('ConnectWatchdog', () => {
  const setup = () => {
    const onStuck = vi.fn();
    const onQrWaitExpired = vi.fn();
    const watchdog = new ConnectWatchdog({
      startMs: START_MS,
      readyMs: READY_MS,
      qrWaitMs: QR_WAIT_MS,
      onStuck,
      onQrWaitExpired,
    });
    return { watchdog, onStuck, onQrWaitExpired };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a connect that shows neither a QR nor authentication', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.start('p1');
    vi.advanceTimersByTime(START_MS - 1);
    expect(onStuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onStuck).toHaveBeenCalledWith('p1', 'starting');
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onQrWaitExpired).not.toHaveBeenCalled();
  });

  it('does not tear down a QR that is waiting for a scan (the old single-timer bug)', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.start('p1');
    vi.advanceTimersByTime(3_000);
    watchdog.qrIssued('p1');
    // The old timer would have fired at START_MS (and again every START_MS after).
    vi.advanceTimersByTime(START_MS * 4);
    expect(onStuck).not.toHaveBeenCalled();
    expect(onQrWaitExpired).not.toHaveBeenCalled();
  });

  it('stops a QR nobody scanned, once, QR_WAIT_MS after the first QR', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.start('p1');
    vi.advanceTimersByTime(3_000);
    watchdog.qrIssued('p1');
    vi.advanceTimersByTime(QR_WAIT_MS - 1);
    expect(onQrWaitExpired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onQrWaitExpired).toHaveBeenCalledTimes(1);
    expect(onQrWaitExpired).toHaveBeenCalledWith('p1');
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onQrWaitExpired).toHaveBeenCalledTimes(1);
    expect(onStuck).not.toHaveBeenCalled();
  });

  it('does not extend the wait when the QR is refreshed (it is, every ~20 s)', () => {
    const { watchdog, onQrWaitExpired } = setup();
    watchdog.start('p1');
    watchdog.qrIssued('p1');
    for (let elapsed = 0; elapsed < QR_WAIT_MS - 20_000; elapsed += 20_000) {
      vi.advanceTimersByTime(20_000);
      watchdog.qrIssued('p1');
    }
    expect(onQrWaitExpired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(onQrWaitExpired).toHaveBeenCalledTimes(1);
  });

  it('switches to the ready deadline once the QR is scanned, and the QR wait no longer applies', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.start('p1');
    watchdog.qrIssued('p1');
    vi.advanceTimersByTime(30_000);
    watchdog.authenticated('p1');
    expect(watchdog.phaseOf('p1')).toBe('authenticated');
    vi.advanceTimersByTime(READY_MS - 1);
    expect(onStuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onStuck).toHaveBeenCalledWith('p1', 'authenticated');
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onQrWaitExpired).not.toHaveBeenCalled();
  });

  it('applies the ready deadline when a stored session authenticates without any QR', () => {
    const { watchdog, onStuck } = setup();
    watchdog.start('p1');
    vi.advanceTimersByTime(10_000);
    watchdog.authenticated('p1');
    vi.advanceTimersByTime(READY_MS);
    expect(onStuck).toHaveBeenCalledWith('p1', 'authenticated');
  });

  it('is cancelled when the profile becomes ready or disconnects', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.start('p1');
    watchdog.qrIssued('p1');
    watchdog.authenticated('p1');
    watchdog.clear('p1');
    expect(watchdog.phaseOf('p1')).toBeUndefined();
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onStuck).not.toHaveBeenCalled();
    expect(onQrWaitExpired).not.toHaveBeenCalled();
  });

  it('restarts the clock on a re-connect instead of stacking a second timer', () => {
    const { watchdog, onStuck } = setup();
    watchdog.start('p1');
    vi.advanceTimersByTime(100_000);
    watchdog.start('p1');
    vi.advanceTimersByTime(100_000); // 200 s after the first start: the first timer is gone
    expect(onStuck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('ignores events for a profile it is not watching', () => {
    const { watchdog, onStuck, onQrWaitExpired } = setup();
    watchdog.qrIssued('ghost');
    watchdog.authenticated('ghost');
    expect(watchdog.phaseOf('ghost')).toBeUndefined();
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onStuck).not.toHaveBeenCalled();
    expect(onQrWaitExpired).not.toHaveBeenCalled();
  });

  it('keeps profiles independent, and clearAll stops them all', () => {
    const { watchdog, onStuck } = setup();
    watchdog.start('a');
    watchdog.start('b');
    watchdog.qrIssued('b');
    vi.advanceTimersByTime(START_MS);
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(onStuck).toHaveBeenCalledWith('a', 'starting');
    watchdog.start('c');
    watchdog.clearAll();
    vi.advanceTimersByTime(QR_WAIT_MS * 2);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });
});

// The timing above only helps if the engine managers feed the watchdog. They are two
// near-identical copies (api and worker) and the adapter has to report authentication,
// so pin the wiring in all three places rather than trusting two copies to stay in step.
describe('the watchdog is wired the same way everywhere', () => {
  const root = path.join(__dirname, '..', '..', '..', '..', '..');
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

  it.each([
    'apps/api/src/modules/profiles/engine-manager.service.ts',
    'apps/worker/src/engine/engine-manager.service.ts',
  ])('%s drives the phased watchdog', (file) => {
    const source = read(file);
    expect(source).toContain('this.watchdog.start(profileId)');
    expect(source).toContain('this.watchdog.qrIssued(profileId)');
    expect(source).toContain('onAuthenticated: () => this.watchdog.authenticated(profileId)');
    expect(source).toContain('this.watchdog.clearAll()');
    // the old single timer, armed when connect() started, must not come back
    expect(source).not.toContain('readyTimers');
  });

  it('the whatsapp-web.js adapter reports authentication', () => {
    expect(read('packages/engines/src/adapters/whatsapp-webjs.adapter.ts')).toContain(
      'this.config?.onAuthenticated?.()',
    );
  });
});

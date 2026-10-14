import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  installBrowserRejectionGuard,
  isBrowserLifecycleError,
  isSessionInvalidReason,
} from '@multiwa/engine-runtime';

describe('isSessionInvalidReason', () => {
  it.each(['LOGOUT', 'Logged Out', 'loggedOut', 'Session Expired. Please reconnect.'])(
    'treats %j as a dead session (clear it, do not retry)',
    (reason) => expect(isSessionInvalidReason(reason)).toBe(true),
  );

  it.each(['NAVIGATION', 'Stream Errored', 'Connection Failure', 'CONFLICT', ''])(
    'keeps %j retryable',
    (reason) => expect(isSessionInvalidReason(reason)).toBe(false),
  );
});

describe('isBrowserLifecycleError', () => {
  it.each([
    "Attempted to use detached Frame 'F90D6AB449DB9F1C446AAA9A48DE3029'.",
    'Protocol error (Runtime.callFunctionOn): Execution context was destroyed.',
    'Protocol error (Runtime.callFunctionOn): Target closed',
    'Protocol error (Page.navigate): Session closed. Most likely the page has been closed.',
    'Navigating frame was detached',
    'Navigation failed because browser has disconnected!',
  ])('recognises the page-went-away error %j', (message) => {
    expect(isBrowserLifecycleError(new Error(message))).toBe(true);
    expect(isBrowserLifecycleError(message)).toBe(true);
  });

  it('does not recognise ordinary failures', () => {
    expect(isBrowserLifecycleError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(false);
    expect(isBrowserLifecycleError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isBrowserLifecycleError('a bare string')).toBe(false);
    expect(isBrowserLifecycleError(undefined)).toBe(false);
    expect(isBrowserLifecycleError(null)).toBe(false);
    expect(isBrowserLifecycleError({ message: 42 })).toBe(false);
  });
});

describe('installBrowserRejectionGuard', () => {
  const setup = () => {
    const source = new EventEmitter();
    const warn = vi.fn();
    installBrowserRejectionGuard(warn, source);
    return { source, warn };
  };

  it('absorbs the rejection a logout navigation leaves behind, and says so', () => {
    const { source, warn } = setup();
    const reason = new Error("Attempted to use detached Frame 'F90D6AB449DB9F1C446AAA9A48DE3029'.");
    expect(() => source.emit('unhandledRejection', reason, Promise.resolve())).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('detached Frame'));
  });

  it('rethrows everything else, so real bugs still crash the process', () => {
    const { source, warn } = setup();
    expect(() =>
      source.emit('unhandledRejection', new Error('connect ECONNREFUSED 127.0.0.1:5432'), Promise.resolve()),
    ).toThrow('ECONNREFUSED');
    expect(() => source.emit('unhandledRejection', 'a bare string', Promise.resolve())).toThrow('a bare string');
    expect(warn).not.toHaveBeenCalled();
  });
});

// The unit tests above prove the listener's decisions; this proves what Node itself
// does with them. It runs the built module in a real child process (the package is
// built before the tests in CI, like every other @multiwa/engine-runtime import).
describe('installBrowserRejectionGuard in a real process', () => {
  const lifecycle = path.join(path.dirname(require.resolve('@multiwa/engine-runtime')), 'engine-lifecycle.js');

  const run = (guarded: boolean, reason: string) =>
    spawnSync(
      process.execPath,
      [
        '-e',
        `${guarded ? `require(${JSON.stringify(lifecycle)}).installBrowserRejectionGuard((m) => console.log('WARN ' + m));` : ''}
         Promise.reject(new Error(${JSON.stringify(reason)}));
         setTimeout(() => console.log('ALIVE'), 150);`,
      ],
      { encoding: 'utf8' },
    );

  const detached = "Attempted to use detached Frame 'F90D6AB449DB9F1C446AAA9A48DE3029'.";

  it('control: the same rejection kills a process that has no guard (the original outage)', () => {
    const result = run(false, detached);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('ALIVE');
  });

  it('keeps the process alive when a browser-lifecycle rejection is guarded', () => {
    const result = run(true, detached);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('WARN');
    expect(result.stdout).toContain('ALIVE');
  });

  it('still lets an unrelated unhandled rejection kill the process', () => {
    const result = run(true, 'boom: not a browser error');
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('ALIVE');
  });
});

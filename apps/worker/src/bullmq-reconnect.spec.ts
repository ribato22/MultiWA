// Regression guard for the BullMQ 6 blocking-connection wedge.
//
// BullMQ 6 arms a watchdog around its blocking bzpopmin read and, on timeout, calls
// `bclient.disconnect(false)` UNCONDITIONALLY. If Redis has already gone away the client is
// in state 'reconnecting', and disconnect(false) cancels its retry timer without emitting
// 'close' — the client becomes a zombie and the Worker never consumes another job. BullMQ 5
// called `disconnect(!this.closing)`, which is why it recovered.
//
// The failure is SILENT and survives every health check we have: the base connection returns
// to 'ready', `queue.add` keeps succeeding, `waiting` grows while `active` stays 0, and the
// worker's readiness probe only inspects the base connection. On wagw the affected queue is
// `webhooks`, so the symptom is "customer webhooks silently stop until someone restarts the
// worker".
//
// patches/bullmq@6.1.1.patch adds the `status === 'ready'` guard. This spec asserts the guard
// is present in BOTH the cjs and esm builds, so a bullmq bump that drops the patch fails CI
// instead of shipping the wedge back to production.
//
// A full behavioural repro (kill Redis for 20s, assert the worker resumes) needs a Redis this
// suite cannot restart, so the byte-level assertion is the guard that runs everywhere. The
// behavioural matrix is recorded in the PR:
//   bullmq 5.81.2            -> RECOVERED
//   bullmq 6.1.0 (unpatched) -> STUCK (0/3 jobs, waiting=3, active=0)
//   bullmq 6.1.0 + guard     -> RECOVERED

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { describe, it, expect } from 'vitest';

const require_ = createRequire(__filename);

function backendSource(flavour: 'cjs' | 'esm'): string {
  const entry = require_.resolve('bullmq');
  // entry is <pkg>/dist/cjs/index.js — walk up to the package root, then into the flavour.
  const pkgRoot = entry.slice(0, entry.indexOf(`${path.sep}dist${path.sep}`));
  return readFileSync(
    path.join(pkgRoot, 'dist', flavour, 'classes', 'redis-queue-backend.js'),
    'utf8',
  );
}

describe('bullmq blocking-connection reconnect patch', () => {
  it.each(['cjs', 'esm'] as const)(
    'guards the watchdog disconnect in the %s build',
    (flavour) => {
      const src = backendSource(flavour);

      // The watchdog must never tear down a client that is already reconnecting.
      expect(src).toContain("bclient.status === 'ready'");

      // Every bclient.disconnect(false) must be paired with a guard. Counting is what makes
      // this robust: if upstream adds a second unguarded teardown, the counts diverge.
      const disconnects = src.match(/bclient\.disconnect\(false\)/g) ?? [];
      const guards = src.match(/bclient\.status === 'ready'/g) ?? [];
      expect(disconnects.length).toBeGreaterThan(0);
      expect(guards).toHaveLength(disconnects.length);
    },
  );

  it('is pinned to the exact bullmq version the patch was built against', () => {
    // pnpm patches are keyed by exact version; a bump silently drops the patch, so the
    // spec above would still pass against an unpatched-but-differently-shaped file only
    // if the anchor changed. Assert the version explicitly to force a deliberate re-patch.
    const pkg = require_('bullmq/package.json') as { version: string };
    expect(pkg.version).toBe('6.1.1');
  });
});

// Send-failure visibility guards.
//
// A production incident on 2026-09-20: ~7% of outgoing messages sat in the
// database as `status: 'failed'` while the api logs held ZERO lines at warn or
// above. Nothing recorded why, and nothing could: `messages` has no error
// column and `metadata` was null on every failed row, so the DB carried the
// verdict without the reason.
//
// Two independent causes, both guarded here.
//
// 1. Both send paths marked the row failed and then left without logging.
//    In the api the send-gate rejection (429: DAILY_LIMIT_REACHED,
//    COLD_DAILY_LIMIT_REACHED, COLD_CIRCUIT_OPEN, REPEAT_SUPPRESSED) is an
//    HttpException, and the `if (error instanceof HttpException) throw error`
//    branch sat ABOVE the `logger.error` call — so the one class of failure
//    operators most need to see was the one class that never logged. The worker
//    copy logged nothing in its catch at all.
//
// 2. The whatsapp-web.js ack map had no `-1` (ACK_ERROR) entry, so a delivery
//    error fell through to `'unknown'`: neither sent nor failed, invisible to
//    any alert keyed on either.
//
// These are source-level assertions on purpose. Reaching the catch block
// through `sendMessage` means mocking the profile, conversation, lane
// classification and queue; that test would assert the mocks more than the
// behaviour. The repo already uses this style — see fastify-single-copy.spec.ts
// and patched-deps-pinned.spec.ts. Each assertion below was negative-control
// checked: deleting the log line, or the `-1` entry, fails it.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('a failed send always leaves a reason behind', () => {
  it('logs the gate rejection BEFORE rethrowing it (api)', () => {
    const src = read('apps/api/src/modules/messages/messages.service.ts');

    const branch = src.match(/if \(error instanceof HttpException\) \{[\s\S]*?\n {6}\}/);
    expect(branch, 'the HttpException rethrow branch should still exist').not.toBeNull();
    expect(
      branch![0],
      'a send-gate 429 marks the message failed and rethrows; without a log inside this branch the failure leaves no trace anywhere',
    ).toMatch(/this\.logger\.(warn|error)\(/);
  });

  it('logs in the worker catch that marks a message failed', () => {
    const src = read('apps/worker/src/engine/messages.service.ts');

    // The catch that writes status:'failed' — currently latent because wagw runs
    // ENGINE_HOST=api, but this fork drifts from the api copy and has bitten
    // before, so hold both to the same rule.
    const idx = src.indexOf("data: { status: 'failed' } });");
    expect(idx, "the worker's failed-marking catch should still exist").toBeGreaterThan(-1);

    const window = src.slice(idx, idx + 900);
    expect(
      window,
      'the worker marks the row failed and returns; without a log the reason is lost',
    ).toMatch(/this\.logger\.(warn|error)\(/);
  });
});

describe('whatsapp-web.js ack map', () => {
  const src = read('packages/engines/src/adapters/whatsapp-webjs.adapter.ts');

  it('maps ACK_ERROR (-1) to failed, not unknown', () => {
    const map = src.match(/export const ACK_STATUS_MAP[\s\S]*?\n\};/);
    expect(map, 'ACK_STATUS_MAP should be exported at module level').not.toBeNull();
    expect(
      map![0],
      "-1 is whatsapp-web.js ACK_ERROR; without it a rejected message is stored as 'unknown'",
    ).toMatch(/\[-1\]:\s*'failed'/);
  });

  it('still maps the ordinary acks', () => {
    const map = src.match(/export const ACK_STATUS_MAP[\s\S]*?\n\};/)![0];
    for (const [ack, status] of [
      ['0', 'pending'],
      ['1', 'sent'],
      ['2', 'delivered'],
      ['3', 'read'],
      ['4', 'played'],
    ]) {
      expect(map, `ack ${ack} should map to ${status}`).toMatch(
        new RegExp(`${ack}:\\s*'${status}'`),
      );
    }
  });
});

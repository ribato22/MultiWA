// Contract tests for verifyWebhookSignature (the SDK helper users rely on to
// authenticate incoming MultiWA webhooks).
//
// The point of these tests is a CROSS-IMPLEMENTATION lock: they independently
// reproduce exactly how the server signs webhooks — HMAC-SHA256 over the
// canonical JSON body, sent as `X-MultiWA-Signature: sha256=<hex>` (see
// apps/api webhooks.service.ts and apps/worker webhook.processor.ts, which MUST
// stay identical) — and assert the shipped verifier accepts it and rejects
// every tampering. If either side drifts, this test fails.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyWebhookSignature } from '../src';

// Mirror of the server's signing (keep in lockstep with the API + worker).
function serverSign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}
function canonicalBody(event: string, profileId: string, data: unknown, timestamp: string): string {
  return JSON.stringify({ event, timestamp, profileId, data });
}

const SECRET = 'whsec_test_1234567890';
const BODY = canonicalBody(
  'message.received',
  'profile-123',
  { id: 'true_628_ABC', body: 'hello', type: 'chat' },
  '2026-07-17T00:00:00.000Z',
);
const HEADER = serverSign(BODY, SECRET);

describe('verifyWebhookSignature', () => {
  it('accepts a signature produced by the server signing scheme', () => {
    expect(verifyWebhookSignature(BODY, HEADER, SECRET)).toBe(true);
  });

  it('accepts a Buffer payload identical to the raw body', () => {
    expect(verifyWebhookSignature(Buffer.from(BODY), HEADER, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(BODY + ' ', HEADER, SECRET)).toBe(false);
    const swapped = canonicalBody('message.received', 'profile-999', {}, '2026-07-17T00:00:00.000Z');
    expect(verifyWebhookSignature(swapped, HEADER, SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature(BODY, HEADER, 'wrong-secret')).toBe(false);
  });

  it('rejects a missing or empty signature', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(verifyWebhookSignature(BODY, HEADER, '')).toBe(false);
  });

  it('does not throw on a malformed (wrong-length) signature and returns false', () => {
    expect(() => verifyWebhookSignature(BODY, 'sha256=deadbeef', SECRET)).not.toThrow();
    expect(verifyWebhookSignature(BODY, 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('rejects a bare hex digest without the sha256= prefix', () => {
    const rawHex = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifyWebhookSignature(BODY, rawHex, SECRET)).toBe(false);
  });
});

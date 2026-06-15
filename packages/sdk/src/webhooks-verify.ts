// MultiWA Gateway SDK — webhook signature verification
// packages/sdk/src/webhooks-verify.ts
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify a MultiWA webhook signature.
 *
 * MultiWA signs every webhook with HMAC-SHA256 over the **raw request body** and
 * sends it in the `X-MultiWA-Signature` header as `sha256=<hex>`.
 *
 * @param payload   The raw request body exactly as received (string or Buffer).
 *                  Pass the RAW body — a re-serialized object will not match.
 * @param signature The `X-MultiWA-Signature` header value (e.g. `sha256=ab12…`).
 * @param secret    The webhook secret you configured when creating the webhook.
 * @returns `true` when the signature is valid; `false` otherwise.
 *
 * @example
 * ```ts
 * app.post('/webhook', (req, res) => {
 *   if (!verifyWebhookSignature(req.rawBody, req.header('x-multiwa-signature'), SECRET)) {
 *     return res.status(401).end();
 *   }
 *   // ...handle the verified event
 * });
 * ```
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Length check first so timingSafeEqual never throws on length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

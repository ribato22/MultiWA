# 09 - Webhook Events

## Overview

MultiWA delivers real-time events to your HTTP endpoints via webhooks.

---

## Configuration

All paths use the API base URL described in [API Specification](./07-api-specification.md#71-overview): Docker default is `http://localhost:3333/api/v1`.

### Per-Profile Webhook
```bash
POST /api/v1/profiles/:id/webhook
{
  "url": "https://yourserver.com/webhook",
  "secret": "optional-hmac-secret",
  "events": ["message.received", "connection.ready"]
}
```

### Global Webhook
```bash
POST /api/v1/webhooks
{
  "url": "https://yourserver.com/webhook",
  "secret": "your-secret",
  "events": ["*"]
}
```

---

## Event Types

| Event | Trigger |
|-------|---------|
| `message.received` | Incoming message |
| `message.sent` | Outgoing message confirmed |
| `message.delivered` | Message delivered (✓✓) |
| `message.read` | Message read (blue ✓✓) |
| `message.failed` | Message delivery failed |
| `connection.qr` | New QR code generated |
| `connection.ready` | WhatsApp connected |
| `connection.disconnected` | WhatsApp disconnected |

---

## Payload Format

```json
{
  "event": "message.received",
  "profileId": "profile-123",
  "timestamp": "2026-02-05T10:00:00.000Z",
  "data": {
    "id": "true_628xxx_3EB0ABC",
    "from": "628123456789@c.us",
    "body": "Hello!",
    "type": "chat",
    "hasMedia": false
  }
}
```

---

## HMAC Verification

If you set a `secret`, verify the signature over the **raw request body** (the exact bytes MultiWA sent), not a re-serialized object:

```javascript
const crypto = require('crypto');

// Capture the RAW request body so the HMAC matches byte-for-byte. MultiWA signs
// the exact bytes it sends, so verify against the raw body — a re-serialized
// object (JSON.stringify(req.body)) is NOT guaranteed to match.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

function verifyWebhook(rawBody, signature, secret) {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = signature || '';
  return expected.length === got.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

// In your handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-multiwa-signature'];
  if (!verifyWebhook(req.rawBody, signature, 'your-secret')) {
    return res.status(401).send('Invalid signature');
  }
  // Process event...
});
```

---

## Delivery & Retry

Webhook delivery is **durable**: events are enqueued to a BullMQ queue and
delivered by the worker, so deliveries survive an API restart and a slow or failing
endpoint never blocks the WhatsApp pipeline. Each delivery is signed with
`X-MultiWA-Signature: sha256=<hmac>` and carries `X-MultiWA-Event`. A 30s per-request
timeout applies.

Failed deliveries (non-2xx, network error, or timeout) are retried with BullMQ
exponential backoff (`delay: 30s`):

| Attempt | Approx. delay before it runs |
|---------|------------------------------|
| 1 | Immediate |
| 2 | ~30 seconds |
| 3 | ~1 minute |
| 4 | ~2 minutes |
| 5 | ~4 minutes |

Retry delays are approximate BullMQ exponential-backoff values. After 5 failed
attempts the job enters the BullMQ failed state. Every attempt (success or failure)
writes a `WebhookLog` row, so the rows for a webhook give the full delivery history.

> Payload logging: the worker honours `WEBHOOK_LOG_PAYLOAD_MAX_BYTES` (default 512;
> `0` omits the payload; `-1` keeps it in full) to control how much of each event
> body is persisted in `WebhookLog`.

---

[← WebSocket API](./08-websocket-api.md) · [Documentation Index](./README.md) · [Messaging →](./10-messaging.md)

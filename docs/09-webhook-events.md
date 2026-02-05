# 09 - Webhook Events

## Overview

MultiWA delivers real-time events to your HTTP endpoints via webhooks.

---

## Configuration

### Per-Profile Webhook
```bash
POST /api/profiles/:id/webhook
{
  "url": "https://yourserver.com/webhook",
  "secret": "optional-hmac-secret",
  "events": ["message.received", "session.status"]
}
```

### Global Webhook
```bash
POST /api/webhooks
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
| `session.connected` | WhatsApp connected |
| `session.disconnected` | WhatsApp disconnected |
| `session.qr` | New QR code generated |

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

If you set a `secret`, verify the signature:

```javascript
const crypto = require('crypto');

function verifyWebhook(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return `sha256=${expected}` === signature;
}

// In your handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-multiwa-signature'];
  if (!verifyWebhook(req.body, signature, 'your-secret')) {
    return res.status(401).send('Invalid signature');
  }
  // Process event...
});
```

---

## Retry Policy

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 10 minutes |
| 5 | 1 hour |

After 5 failed attempts, the webhook is marked as failing.

---

[← WebSocket API](./08-websocket-api.md) · [Documentation Index](./README.md) · [Messaging →](./10-messaging.md)

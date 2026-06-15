# 20 - Examples & Recipes

Practical, copy-pasteable examples for the most common MultiWA integrations:
webhook receivers in three languages, advanced automation rules, and scheduling
a broadcast over the REST API.

All REST calls use the `/api/v1` prefix and authenticate with an API key header:

```
X-API-Key: <your-api-key>
```

(JWT works too — send `Authorization: Bearer <token>` instead.)

---

## 1. Webhook integration

MultiWA delivers events (`message.received`, `session.status`, …) as `POST`
requests to your endpoint. When the webhook has a `secret`, each request carries
an HMAC-SHA256 signature header so you can verify it came from MultiWA:

```
X-MultiWA-Signature: sha256=<hex>
```

The signature is `HMAC_SHA256(raw_request_body, secret)`. **Always verify against
the raw body** (not a re-serialized object).

### Node.js (Express)

```js
const express = require('express');
const crypto = require('crypto');

const SECRET = process.env.MULTIWA_WEBHOOK_SECRET;
const app = express();

// Capture the raw body so the HMAC matches byte-for-byte.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

function verify(req) {
  const expected =
    'sha256=' + crypto.createHmac('sha256', SECRET).update(req.rawBody).digest('hex');
  const got = req.headers['x-multiwa-signature'] || '';
  return expected.length === got.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

app.post('/webhook', (req, res) => {
  if (SECRET && !verify(req)) return res.status(401).send('bad signature');

  const { event, profileId, data } = req.body;
  if (event === 'message.received') {
    console.log(`[${profileId}] ${data.from}: ${data.body}`);
  }
  res.sendStatus(200); // ACK fast; do heavy work async
});

app.listen(3000, () => console.log('Webhook listening on :3000'));
```

### Python (Flask)

```python
import hmac, hashlib, os
from flask import Flask, request, abort

SECRET = os.environ["MULTIWA_WEBHOOK_SECRET"].encode()
app = Flask(__name__)

def verify(raw_body: bytes, signature: str) -> bool:
    expected = "sha256=" + hmac.new(SECRET, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")

@app.post("/webhook")
def webhook():
    if SECRET and not verify(request.get_data(), request.headers.get("X-MultiWA-Signature")):
        abort(401)

    payload = request.get_json()
    if payload.get("event") == "message.received":
        d = payload["data"]
        print(f'[{payload["profileId"]}] {d["from"]}: {d.get("body")}')
    return "", 200

if __name__ == "__main__":
    app.run(port=3000)
```

### PHP

```php
<?php
$secret = getenv('MULTIWA_WEBHOOK_SECRET');
$raw = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_MULTIWA_SIGNATURE'] ?? '';

if ($secret) {
    $expected = 'sha256=' . hash_hmac('sha256', $raw, $secret);
    if (!hash_equals($expected, $sig)) {
        http_response_code(401);
        exit('bad signature');
    }
}

$payload = json_decode($raw, true);
if (($payload['event'] ?? '') === 'message.received') {
    $d = $payload['data'];
    error_log("[{$payload['profileId']}] {$d['from']}: " . ($d['body'] ?? ''));
}
http_response_code(200);
```

### Register the endpoint

```bash
curl -X POST https://your-multiwa-host/api/v1/webhooks \
  -H "X-API-Key: $MULTIWA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://yourserver.com/webhook",
    "secret": "a-long-random-string",
    "events": ["message.received", "session.status"]
  }'
```

> Reply `2xx` quickly. Do slow work (DB writes, outbound calls) in a queue —
> MultiWA retries on non-2xx responses.

---

## 2. Advanced automation rules

Automations pair a **trigger** with an **action**. Create them via
`POST /api/v1/automation` (or visually in the dashboard's Flow Builder).

### Keyword → AI reply

```json
{
  "profileId": "profile-uuid",
  "name": "Pricing auto-responder",
  "trigger": { "type": "keyword", "value": ["price", "pricing", "harga"] },
  "action": {
    "type": "ai_reply",
    "knowledgeBase": true,
    "fallback": "Thanks! Our team will follow up with pricing shortly."
  },
  "enabled": true
}
```

### Regex trigger → tag + templated reply

```json
{
  "profileId": "profile-uuid",
  "name": "Order status",
  "trigger": { "type": "regex", "value": "#\\d{4,6}" },
  "actions": [
    { "type": "add_tag", "value": "order-inquiry" },
    { "type": "send", "message": { "type": "text", "text": "Got it — checking order {{match}} now." } }
  ],
  "enabled": true
}
```

### New-contact welcome with a delay

```json
{
  "profileId": "profile-uuid",
  "name": "Welcome new contacts",
  "trigger": { "type": "new_contact" },
  "actions": [
    { "type": "delay", "ms": 3000 },
    { "type": "send", "message": { "type": "text", "text": "👋 Welcome to MultiWA! Reply MENU to see options." } }
  ],
  "enabled": true
}
```

> Triggers: `keyword`, `regex`, `new_contact`, `schedule`.
> Actions: `send`, `ai_reply`, `add_tag`, `webhook`, `delay`.

---

## 3. Schedule a broadcast via the API

A scheduled broadcast is a two-step flow: **create**, then **schedule**.

### Step 1 — Create the broadcast

```bash
curl -X POST https://your-multiwa-host/api/v1/broadcast \
  -H "X-API-Key: $MULTIWA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "profile-uuid",
    "name": "February Promo",
    "message": { "type": "text", "text": "Hi {{name}}! 20% off this week: {{link}}" },
    "recipients": { "type": "tags", "value": ["vip", "newsletter"] },
    "settings": { "delayMin": 3000, "delayMax": 10000, "batchSize": 50, "retryFailed": true, "retryAttempts": 3 }
  }'
# → { "id": "broadcast-uuid", "status": "draft", ... }
```

`recipients.type` can be `tags` (tag names), `contacts` (contact IDs), or `all`.
The per-message `delayMin`/`delayMax` jitter helps stay within WhatsApp's
anti-spam limits.

### Step 2 — Schedule it

```bash
curl -X POST https://your-multiwa-host/api/v1/broadcast/broadcast-uuid/schedule \
  -H "X-API-Key: $MULTIWA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "scheduledAt": "2026-02-20T09:00:00.000Z" }'
# → status becomes "scheduled"; the worker sends it at that time
```

To send immediately instead, call `POST /api/v1/broadcast/{id}/start`.

### Track progress

```bash
curl https://your-multiwa-host/api/v1/broadcast/broadcast-uuid/stats \
  -H "X-API-Key: $MULTIWA_API_KEY"
# → { "total": 1240, "sent": 1240, "failed": 3, "status": "completed" }
```

You can `pause`, `resume`, or `cancel` a running broadcast with the matching
`POST /api/v1/broadcast/{id}/{action}` endpoints.

---

## See also

- [07 - API Specification](./07-api-specification.md)
- [09 - Webhook Events](./09-webhook-events.md)
- [12 - Automation](./12-automation.md)
- [13 - Python SDK](./13-sdk-python.md) · [14 - PHP SDK](./14-sdk-php.md)

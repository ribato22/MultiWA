# 09 - Webhook Events

## Overview

MultiWA delivers real-time events to your HTTP endpoints via webhooks.

---

## Configuration

All paths use the API base URL described in [API Specification](./07-api-specification.md#71-overview): Docker default is `http://localhost:3333/api/v1`.

### Create a Webhook

A webhook belongs to one profile. Create it with `POST /api/v1/webhooks`:

```bash
curl -X POST http://localhost:3333/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "profileId": "profile-123",
    "url": "https://your-server.example.com/webhook",
    "events": ["message.received", "connection.ready"]
  }'
```

`events` lists event names; there is no wildcard. Subscribe to each event you need (see [Event Types](#event-types)).

MultiWA generates the signing secret itself; a `secret` field in the request is ignored. The response is the created webhook, and its `secret` field is the key for [HMAC Verification](#hmac-verification). `GET /api/v1/webhooks/:id` returns it again.

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
| `call.received` | An incoming call started ringing |
| `call.answered` | An agent answered a ringing call in the dashboard |
| `call.rejected` | A ringing call was rejected: automatically, by an agent, or on the phone |
| `call.ended` | A ringing call stopped ringing without being rejected (missed, answered on another device, or unknown), or a call answered in the dashboard ended |
| `call.updated` | The call changed after that: its outcome was settled later, or its follow-up status or assignee changed |
| `call.recording.deleted` | A call's recording was deleted: by an admin, or at the end of its profile's retention period |

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

### Call events

An incoming WhatsApp call produces `call.received`, `call.answered`, `call.rejected`, `call.ended` and `call.updated`; subscribe to them by name, like any other event. All five carry the same `data`: the call as it stands when the event is sent.

```json
{
  "event": "call.ended",
  "profileId": "profile-123",
  "timestamp": "2026-10-26T03:00:31.250Z",
  "data": {
    "profileId": "profile-123",
    "callId": "0b6c1e1a-3f5a-4c1e-9a52-7d1f5c3e8b41",
    "waCallId": "3A9F1C5E7B2D4086A1C3E5F70912B4D6",
    "from": "628123456789@s.whatsapp.net",
    "isVideo": false,
    "isGroup": false,
    "direction": "incoming",
    "outcome": "missed",
    "rejectedBy": null,
    "startedAt": "2026-10-26T03:00:00.000Z",
    "endedAt": "2026-10-26T03:00:31.000Z",
    "followUp": "open",
    "assignedUserId": null,
    "answeredByUserId": null,
    "answeredAt": null,
    "endedBy": null,
    "endReason": null,
    "talkSeconds": null
  }
}
```

| Field | Meaning |
|-------|---------|
| `callId` | MultiWA's id for the call, the one `/calls/:id` takes |
| `waCallId` | The engine's id for the call |
| `from` | The caller as a chat JID, in the form MultiWA stores chats under: `<number>@s.whatsapp.net` (never `@c.us`), or `<id>@lid` when WhatsApp hides the number and it could not be resolved |
| `isVideo`, `isGroup` | Video call; group call |
| `direction` | Always `incoming` |
| `outcome` | `ringing`; `answered` (answered in the dashboard); `missed`; `rejected`; `answered_elsewhere` (answered on another device of the account); `unknown` (it stopped ringing and the engine could not tell how) |
| `rejectedBy` | Who rejected the call: `auto` (the profile's auto-reject), `agent` (the API or the Calls page), `device` (the phone). `null` unless `outcome` is `rejected` |
| `startedAt`, `endedAt` | ISO 8601; `endedAt` is `null` while the call rings |
| `followUp` | `open` (the default), `in_progress` or `done`. An `open` call becomes `done` by itself once it is answered in the dashboard or known to have been answered on another device |
| `assignedUserId` | The user the call is assigned to, or `null` |
| `answeredByUserId` | The agent who answered the call in the dashboard, or `null` |
| `answeredAt` | When WhatsApp connected that agent (ISO 8601), or `null` |
| `endedBy` | For a call answered in the dashboard: `agent`, `caller` or `server`; else `null` |
| `endReason` | For a call answered in the dashboard: `hangup`, `caller_hangup`, `agent_lost`, `media_failed`, `time_limit` or `server_restart`; else `null` |
| `talkSeconds` | For a call answered in the dashboard: its talk time in seconds; else `null` |

**When each event is sent**

- `call.received`: a call started ringing (`outcome` is `ringing`).
- `call.answered`: an agent answered the call in the dashboard (`outcome` is `answered`).
- `call.rejected`: a ringing call was rejected.
- `call.ended`: a ringing call stopped ringing without being rejected; `outcome` is `missed`, `answered_elsewhere` or `unknown`. A call still ringing after `CALL_RING_TIMEOUT_MS` (90 seconds by default) ends as `unknown`. For a call answered in the dashboard it comes when the call is over, with `endedBy`, `endReason` and `talkSeconds`.
- `call.updated`: any change after that. WhatsApp's call log settles an `unknown` outcome (to `missed`, `rejected` or `answered_elsewhere`), or the follow-up status or the assignee changes, through the API or the Calls page. An agent's reply or call link also moves `open` to `in_progress`.

What the engine reports decides which event carries the final outcome (see [Engine Abstraction](./06-engine-abstraction.md#calls)), so read `outcome` rather than the event name:

- Auto-rejected: `call.received`, then `call.rejected` with `rejectedBy: "auto"`.
- Missed on whatsapp-web.js, which cannot tell how a call ended: `call.received`, `call.ended` with `outcome: "unknown"`, and moments later `call.updated` with `outcome: "missed"`, once WhatsApp's call log arrives.
- Missed on Baileys: `call.received`, then `call.ended` with `outcome: "missed"` when the call rang out. A caller who hangs up first ends as `unknown`, and Baileys reports no call log to settle it.
- Answered in the dashboard: `call.received`, `call.answered`, then `call.ended` with `outcome: "answered"` when it is over. A restart of MultiWA ends it with `endReason: "server_restart"`: a normal stop sends its `call.ended` as it shuts down, with the talk time up to then; a crash leaves it to the next start, which sends it with `talkSeconds: null` (unknown).

A call still ringing when MultiWA restarts skips part of this: it is closed as `unknown` at the next start, without a `call.ended`, and stays `unknown`, since an engine passes on only the call log of a call it saw ringing since it last connected.

**Deduplicating.** A delivery is retried when your endpoint fails or times out, and call events carry no event id, so the same event can arrive twice. A call gets at most one `call.received`, at most one `call.answered`, and at most one of `call.rejected` and `call.ended`, so `callId` plus the event name identifies those. `call.updated` can follow several times for one call, even with the same `outcome` (a follow-up or assignee change), so do not deduplicate it on `outcome`. Every event carries the whole call: keep the newest, and read `GET /calls/:id` when the order matters, since a retried delivery can arrive after a later event of the same call.

### Call recording events

`call.recording.deleted` names the recording, never its audio (that is fetched through `GET /calls/:id/recording`):

```json
{
  "event": "call.recording.deleted",
  "profileId": "profile-123",
  "timestamp": "2026-10-31T19:30:02.120Z",
  "data": {
    "profileId": "profile-123",
    "callId": "0b6c1e1a-3f5a-4c1e-9a52-7d1f5c3e8b41",
    "recordingId": "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
    "reason": "retention",
    "deletedAt": "2026-10-31T19:30:02.000Z"
  }
}
```

`reason` is `admin` (`DELETE /calls/:id/recording`) or `retention` (the nightly job, past the profile's `retentionDays`). A recording is deleted once, so `recordingId` identifies the event.

---

## HMAC Verification

Every delivery is signed with the webhook's `secret` (returned when you [create the webhook](#create-a-webhook)). Verify the signature over the **raw request body** (the exact bytes MultiWA sent), not a re-serialized object:

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

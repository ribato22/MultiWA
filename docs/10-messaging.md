# 10 - Messaging

## Overview

Send and receive all types of WhatsApp messages.

---

## Message Types

All paths use the global `/api/v1` prefix (Docker default base URL: `http://localhost:3333/api/v1`).

| Type | Endpoint | Description |
|------|----------|-------------|
| Text | `POST /api/v1/messages/text` | Plain text messages |
| Image | `POST /api/v1/messages/image` | Images with caption |
| Video | `POST /api/v1/messages/video` | Videos with caption |
| Audio | `POST /api/v1/messages/audio` | Voice/audio files |
| Document | `POST /api/v1/messages/document` | Files/PDFs |
| Location | `POST /api/v1/messages/location` | Map locations |
| Contact | `POST /api/v1/messages/contact` | Contact cards |
| Poll | `POST /api/v1/messages/poll` | Interactive polls |

---

## Send Text

```bash
curl -X POST http://localhost:3333/api/v1/messages/text \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "profileId": "profile-123",
    "to": "628123456789",
    "text": "Hello from MultiWA!"
  }'
```

---

## Send Image

```bash
curl -X POST http://localhost:3333/api/v1/messages/image \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "profileId": "profile-123",
    "to": "628123456789",
    "url": "https://example.com/image.jpg",
    "caption": "Check this out!"
  }'
```

---

## Send Poll

```bash
curl -X POST http://localhost:3333/api/v1/messages/poll \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "profileId": "profile-123",
    "to": "628123456789",
    "question": "What is your favorite color?",
    "options": ["Red", "Blue", "Green"],
    "allowMultiple": false
  }'
```

---

## Phone Number Format

Both formats are accepted:

| Format | Example |
|--------|---------|
| Without suffix | `628123456789` |
| With suffix | `628123456789@c.us` |

For groups, use the full JID: `123456789-123456@g.us`

---

## Response

```json
{
  "success": true,
  "data": {
    "messageId": "true_628xxx_3EB0ABC",
    "status": "sent",
    "timestamp": "2026-02-05T10:00:00.000Z"
  }
}
```

---

## Send Gate (pacing & daily limit)

Every outbound send — direct API, automation, broadcast, scheduled, and bulk —
passes through a **per-profile send gate** that enforces anti-ban pacing:

| Profile field | Meaning | Default |
|---------------|---------|---------|
| `messageDelayMs` | Minimum delay between consecutive messages for the profile. The gate serializes sends per profile and waits out the remaining delay (block-and-wait). | `1500` |
| `dailyMessageLimit` | Daily outbound cap for the profile. `null` = unlimited. | `null` (unlimited) |
| `dailyMessageCount` | Messages sent so far in the current window (read-only). | `0` |
| `dailyResetAt` | When the counter next resets (00:00 WIB / Asia-Jakarta). | — |

Set `messageDelayMs` / `dailyMessageLimit` via `PUT /profiles/:id`.

When a profile reaches its `dailyMessageLimit`, further sends are rejected with
**HTTP 429**:

```json
{ "error": "DAILY_LIMIT_REACHED", "limit": 1000, "count": 1000, "resetAt": "2026-06-17T00:00:00+07:00" }
```

Counters reset daily at **midnight WIB (Asia/Jakarta, UTC+7)**.

## Durable Sending (optional)

By default, `POST /messages/...` sends synchronously and returns the result
(`status: "sent"`). Set **`DURABLE_SEND=true`** to make sending durable:

- The API enqueues the send to a Redis-backed queue and returns **`202`** with
  `{ "success": true, "status": "queued", "messageId": "<id>" }` immediately.
- An in-process consumer drains the queue and performs the actual send through the
  send gate. Jobs survive an API restart and are retried (3 attempts, exponential
  backoff) on transient failure.
- The final outcome surfaces via the message's `status` (`sent` / `failed`) and
  the `message.sent` / `message.failed` webhook events.
- The daily limit is still enforced synchronously where possible: an over-limit
  send is rejected with the same **`429 DAILY_LIMIT_REACHED`** before enqueue. In
  a rare race, a queued send can instead end as `status: "failed"` with a
  `message.failed` event.

> Contract note: when `DURABLE_SEND=true`, send endpoints return `202 queued`
> rather than a synchronous `sent` result. Consumers should track delivery via
> `message.status` or webhook events. `OUTBOUND_SEND_CONCURRENCY` (default 10)
> tunes throughput; per-profile ordering and pacing are preserved regardless.

## Global Rate Limit

- **API throttle**: 120 requests/minute per IP (global `ThrottlerGuard`).
- **Bulk API**: use `POST /api/v1/bulk/send` for high-volume sends — it routes
  through the same per-profile send gate (so `messageDelayMs` and the daily limit
  apply) plus its own configurable inter-message delay.

---

[← Webhook Events](./09-webhook-events.md) · [Documentation Index](./README.md) · [Groups →](./11-groups.md)

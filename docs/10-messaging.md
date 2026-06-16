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

## Global Rate Limit

- **API throttle**: 120 requests/minute per IP (global `ThrottlerGuard`).
- **Bulk API**: use `POST /api/v1/bulk/send` for high-volume sends — it routes
  through the same per-profile send gate (so `messageDelayMs` and the daily limit
  apply) plus its own configurable inter-message delay.

---

[← Webhook Events](./09-webhook-events.md) · [Documentation Index](./README.md) · [Groups →](./11-groups.md)

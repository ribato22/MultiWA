# 10 - Messaging

## Overview

Send and receive all types of WhatsApp messages.

---

## Message Types

| Type | Endpoint | Description |
|------|----------|-------------|
| Text | `POST /messages/text` | Plain text messages |
| Image | `POST /messages/image` | Images with caption |
| Video | `POST /messages/video` | Videos with caption |
| Audio | `POST /messages/audio` | Voice/audio files |
| Document | `POST /messages/document` | Files/PDFs |
| Location | `POST /messages/location` | Map locations |
| Contact | `POST /messages/contact` | Contact cards |
| Poll | `POST /messages/poll` | Interactive polls |

---

## Send Text

```bash
curl -X POST http://localhost:3001/api/messages/text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "profileId": "profile-123",
    "to": "628123456789",
    "text": "Hello from MultiWA!"
  }'
```

---

## Send Image

```bash
curl -X POST http://localhost:3001/api/messages/image \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
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
curl -X POST http://localhost:3001/api/messages/poll \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
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

## Rate Limits

- **Per profile**: 30 messages/minute (adjustable)
- **Bulk API**: Use `/bulk/send` for high-volume

---

[← Webhook Events](./09-webhook-events.md) · [Documentation Index](./README.md) · [Groups →](./11-groups.md)

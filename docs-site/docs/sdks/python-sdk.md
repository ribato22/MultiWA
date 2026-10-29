---
sidebar_position: 1
title: "Python SDK"
---

# 13 - Python SDK

Official Python SDK for MultiWA.

---

## Installation

```bash
pip install multiwa
```

---

## Quick Start

```python
from multiwa import MultiWA

# Initialize client (base_url includes /api/v1)
client = MultiWA(
    base_url="http://localhost:3333/api/v1",
    api_key="YOUR_API_KEY"
)

# Send a text message
result = client.messages.send_text(
    profile_id="profile-123",
    to="628123456789",
    text="Hello from Python!"
)

print(f"Message {result.status}: {result.message_id}")
```

A request the API refuses raises `httpx.HTTPStatusError` (for example 429 when
a daily send limit is reached). An argument the API cannot honour raises
`ValueError` before anything is sent.

---

## Async Client

`AsyncMultiWA` has the same resources and methods; await each call.

```python
from multiwa import AsyncMultiWA
import asyncio

async def main():
    async with AsyncMultiWA(
        base_url="http://localhost:3333/api/v1",
        api_key="YOUR_API_KEY"
    ) as client:
        result = await client.messages.send_text(
            profile_id="profile-123",
            to="628123456789",
            text="Hello async!"
        )

asyncio.run(main())
```

---

## API Reference

### Messages

```python
# Text (quoted_message_id quotes a message)
client.messages.send_text(profile_id, to, text, quoted_message_id=None)

# Image / video: url= or base64=
client.messages.send_image(profile_id, to, url=None, base64=None, caption=None, mimetype=None)
client.messages.send_video(profile_id, to, url=None, base64=None, caption=None, mimetype=None)

# Audio; ptt=True sends a voice note
client.messages.send_audio(profile_id, to, url=None, base64=None, mimetype=None, ptt=False)

# Document
client.messages.send_document(profile_id, to, filename, url=None, base64=None, mimetype=None)

# Location
client.messages.send_location(profile_id, to, latitude, longitude, name=None, address=None)

# Contact card
client.messages.send_contact(profile_id, to, name, phone, email=None)

# Poll (2 to 12 options)
client.messages.send_poll(profile_id, to, question, options, allow_multiple_answers=False)

# Reaction: message_id is MultiWA's message id (MessageResult.message_id); "" removes it
client.messages.send_reaction(profile_id, message_id, emoji)

# Stored messages, newest first
client.messages.list(profile_id, limit=50, offset=0, message_type=None, direction=None)
```

Every send returns a `MessageResult`: `success`, `message_id` (MultiWA's id),
`conversation_id`, `status` (`queued`, `sent` or `failed`), `wa_message_id`
(WhatsApp's id, once sent) and `error`.

### Contacts

```python
# List (tags matches contacts with any of them)
contacts = client.contacts.list(profile_id, limit=50, offset=0, search=None, tags=None)

# Create (an existing phone number is updated, tags and metadata merged)
contact = client.contacts.create(profile_id, phone, name=None, tags=None, metadata=None)

# Get / update (tags and metadata replace the stored values) / delete
client.contacts.get(contact_id)
client.contacts.update(contact_id, name=None, tags=None, metadata=None)
client.contacts.delete(contact_id)

# Tags
client.contacts.add_tags(contact_id, ["vip"])
client.contacts.remove_tags(contact_id, ["vip"])
```

The API stores no email for a contact; keep it in `metadata`. `Contact.email`
is always `None`, and passing `email=` raises `ValueError`.

### Broadcasts

```python
# Create a draft campaign
campaign = client.broadcasts.create(
    profile_id="profile-123",
    name="Promo Campaign",
    recipients={"type": "tags", "value": ["customer"]},
    message="Hello! Our promo starts today.",
    settings={"delayMin": 3000, "delayMax": 10000, "batchSize": 50},  # optional pacing
)

# Start now, or schedule a draft (ISO 8601 string or timezone-aware datetime)
client.broadcasts.start(campaign.id)
client.broadcasts.schedule(campaign.id, "2026-12-01T09:00:00Z")

# Control
client.broadcasts.pause(campaign.id)
client.broadcasts.resume(campaign.id)
client.broadcasts.cancel(campaign.id)   # the API marks it "failed"
client.broadcasts.delete(campaign.id)   # not while it runs

# Read
client.broadcasts.get(campaign.id)
client.broadcasts.list(profile_id, status=None, limit=None, offset=0)
stats = client.broadcasts.stats(campaign.id)  # successRate and progress in percent
```

- `recipients`: `{"type": "tags" | "contacts" | "all", "value": [...]}` (tag
  names, or contact ids / phone numbers), or a plain list of phone numbers.
- `message`: plain text, or a message object such as
  `{"type": "image", "url": "https://...", "text": "Caption"}`.
- `create(..., schedule_at=...)` creates and schedules in one call; if the
  schedule is refused, the draft is deleted and the error raised.
- `start()` and `resume()` return the broadcast as it is after the action.
- `Broadcast` reads `total_recipients`, `sent_count`, `delivered_count` and
  `failed_count` from the API's `stats`.

### Profiles

```python
# List (optionally one workspace)
profiles = client.profiles.list(workspace_id=None)

# Create / get / rename / delete
profile = client.profiles.create(workspace_id, name="My WhatsApp", engine="whatsapp-web-js")
client.profiles.get(profile.id)
client.profiles.update(profile.id, name="Sales")
client.profiles.delete(profile.id)

# Connect, check, disconnect
client.profiles.connect(profile.id)
client.profiles.status(profile.id)      # status, phone, lastConnectedAt, engineConnected
client.profiles.disconnect(profile.id)
```

There is no REST route for the QR code: after `connect()`, take it from the
[WebSocket](<../api/websocket-api.md>) `qr:update` event or a `connection.qr`
[webhook](<../api/webhook-events.md>). `profiles.get_qr()` is deprecated and raises
`NotImplementedError`.

### Webhooks

```python
# Create; the API generates the signing secret (webhook.secret)
webhook = client.webhooks.create(profile_id, url, events=["message.received"])

client.webhooks.list(profile_id)
client.webhooks.get(webhook.id)
client.webhooks.update(webhook.id, url=None, events=None, is_active=None)
client.webhooks.test(webhook.id)
client.webhooks.delete(webhook.id)
```

Verify each delivery against the raw request body:

```python
from multiwa import verify_webhook_signature

ok = verify_webhook_signature(raw_body, headers["X-MultiWA-Signature"], webhook.secret)
```

### Other endpoints

```python
# Any other route, relative to base_url; returns the decoded JSON
groups = client.request("GET", f"/groups/profile/{profile_id}")
```

---

## Type Hints

All models use Pydantic for type safety:

```python
from multiwa.types import MessageResult, Contact, Profile

# Full autocomplete and type checking
result: MessageResult = client.messages.send_text(...)
contact: Contact = client.contacts.get(...)
```

---

[← Automation](<../features/automation.md>) · [Documentation Index](<../intro.md>) · [PHP SDK →](<php-sdk.md>)

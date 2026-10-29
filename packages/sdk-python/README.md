# MultiWA Python SDK

Official Python SDK for [MultiWA](https://github.com/ribato22/multiwa) - WhatsApp Business API Gateway.

## Installation

```bash
pip install multiwa
```

To work on the SDK itself, install it from the MultiWA monorepo:

```bash
pip install -e "packages/sdk-python[dev]"
```

## Quick Start

```python
from multiwa import MultiWA

# Initialize the client. base_url must include the API prefix /api/v1.
#   Local dev: http://localhost:3000/api/v1
#   Docker:    http://localhost:3333/api/v1
#   Prod:      https://your-multiwa-instance.com/api/v1
client = MultiWA(
    base_url="https://your-multiwa-instance.com/api/v1",
    api_key="your-api-key",
)

# Send a text message
result = client.messages.send_text(
    profile_id="your-profile-id",
    to="6281234567890",
    text="Hello from MultiWA Python SDK!"
)

print(result.status, result.message_id)
```

A request the API refuses raises `httpx.HTTPStatusError` (for example 429
when a daily send limit is reached). An argument the API cannot honour raises
`ValueError` before anything is sent.

## Features

### Messages

```python
# Send text, optionally quoting a message
client.messages.send_text(profile_id, to, text)

# Send image / video (url= or base64=)
client.messages.send_image(profile_id, to, url="https://...", caption="Check this!")
client.messages.send_video(profile_id, to, url="https://...", caption="Watch this!")

# Send audio; ptt=True sends a voice note
client.messages.send_audio(profile_id, to, url="https://...", ptt=True)

# Send document
client.messages.send_document(profile_id, to, filename="report.pdf", url="https://...")

# Send location
client.messages.send_location(profile_id, to, latitude=-6.2088, longitude=106.8456)

# Send contact
client.messages.send_contact(profile_id, to, name="John Doe", phone="+6281234567890")

# Send poll (2 to 12 options)
client.messages.send_poll(
    profile_id, to,
    question="What's your favorite color?",
    options=["Red", "Green", "Blue"]
)

# React to a message: message_id is MultiWA's id (result.message_id), not WhatsApp's
client.messages.send_reaction(profile_id, result.message_id, "👍")

# List stored messages, newest first
messages = client.messages.list(profile_id, limit=50, offset=0)
```

Every send returns a `MessageResult`: `success`, `message_id` (MultiWA's id),
`conversation_id`, `status` (`queued`, `sent` or `failed`), `wa_message_id`
(WhatsApp's id, once sent) and `error`.

### Broadcasts

```python
# Create a draft broadcast
broadcast = client.broadcasts.create(
    profile_id="...",
    name="Promo Campaign",
    recipients={"type": "tags", "value": ["customer", "vip"]},
    message="Hello! Our promo starts today.",
)

# recipients can also be {"type": "contacts", "value": [contact ids or phone numbers]},
# {"type": "all", "value": []}, or a plain list of phone numbers.
# message can also be a message object, e.g. {"type": "image", "url": "https://...", "text": "Caption"}.
# settings sets the pacing, e.g. settings={"delayMin": 3000, "delayMax": 10000, "batchSize": 50}.

# Start now, or schedule a draft for later (an ISO 8601 string or a timezone-aware datetime)
client.broadcasts.start(broadcast.id)
client.broadcasts.schedule(broadcast.id, "2026-12-01T09:00:00Z")
# create(..., schedule_at=...) does both steps at once

client.broadcasts.pause(broadcast.id)
client.broadcasts.resume(broadcast.id)
client.broadcasts.cancel(broadcast.id)  # the API marks it "failed"

stats = client.broadcasts.stats(broadcast.id)  # includes successRate and progress (percent)
broadcasts = client.broadcasts.list(profile_id, status="running")
```

`Broadcast` reads its counts (`total_recipients`, `sent_count`,
`delivered_count`, `failed_count`) from the API's `stats`.

### Contacts

```python
# Create a contact (an existing phone number is updated, tags merged)
contact = client.contacts.create(
    profile_id="...",
    phone="6281234567890",
    name="John Doe",
    tags=["customer", "vip"],
    metadata={"email": "john@example.com"},
)

# List and filter (tags matches contacts with any of them)
contacts = client.contacts.list(profile_id, search="john", tags=["vip"], limit=50)

client.contacts.update(contact.id, name="John D.")
client.contacts.add_tags(contact.id, ["newsletter"])
client.contacts.remove_tags(contact.id, ["vip"])
client.contacts.delete(contact.id)
```

The API stores no email for a contact: keep it in `metadata`. `Contact.email`
is always `None`, and passing `email=` raises `ValueError`.

### Profiles

```python
profile = client.profiles.create(workspace_id="...", name="Sales")
client.profiles.connect(profile.id)
status = client.profiles.status(profile.id)  # status, phone, engineConnected, ...
profiles = client.profiles.list()
```

The QR code to link a profile is not available over REST: after `connect()`,
take it from the [WebSocket](https://github.com/ribato22/MultiWA/blob/main/docs/08-websocket-api.md) `qr:update` event
or a `connection.qr` [webhook](https://github.com/ribato22/MultiWA/blob/main/docs/09-webhook-events.md).
`profiles.get_qr()` is deprecated and raises `NotImplementedError`.

### Webhooks

```python
# Create webhook; the API generates the signing secret
webhook = client.webhooks.create(
    profile_id="...",
    url="https://your-webhook.com/whatsapp",
    events=["message.received", "message.sent"]
)
print(webhook.secret)

client.webhooks.update(webhook.id, is_active=False)  # disable
client.webhooks.test(webhook.id)
```

Verify each delivery against the raw request body:

```python
from multiwa import verify_webhook_signature

ok = verify_webhook_signature(raw_body, request.headers["X-MultiWA-Signature"], webhook.secret)
```

## Async Support

`AsyncMultiWA` has the same resources and methods; await each call.

```python
import asyncio
from multiwa import AsyncMultiWA

async def main():
    async with AsyncMultiWA(
        base_url="https://your-multiwa-instance.com/api/v1",
        api_key="your-api-key"
    ) as client:
        result = await client.messages.send_text(
            profile_id="...",
            to="6281234567890",
            text="Hello async!"
        )
        print(result)

asyncio.run(main())
```

## Other endpoints

`client.request(method, path, **kwargs)` calls any other route, relative to
`base_url`, and returns the decoded JSON:

```python
groups = client.request("GET", f"/groups/profile/{profile_id}")
```

Both clients take a `transport=` argument that is passed to httpx, e.g.
`httpx.HTTPTransport(retries=3)` or an `httpx.MockTransport` in tests.

## Development

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest -q
.venv/bin/ruff check . && .venv/bin/mypy multiwa
```

## License

MIT - See [LICENSE](LICENSE) for details.

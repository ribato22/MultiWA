# MultiWA Python SDK

Official Python SDK for [MultiWA](https://github.com/ribato22/multiwa) - WhatsApp Business API Gateway.

## Installation

```bash
pip install multiwa
```

## Quick Start

```python
from multiwa import MultiWA

# Initialize the client
client = MultiWA(
    base_url="https://your-multiwa-instance.com/api",
    api_key="your-api-key"
)

# Send a text message
result = client.messages.send_text(
    profile_id="your-profile-id",
    to="6281234567890",
    text="Hello from MultiWA Python SDK!"
)

print(result)
```

## Features

### Messages

```python
# Send text
client.messages.send_text(profile_id, to, text)

# Send image
client.messages.send_image(profile_id, to, url="https://...", caption="Check this!")

# Send video
client.messages.send_video(profile_id, to, url="https://...", caption="Watch this!")

# Send document
client.messages.send_document(profile_id, to, url="https://...", filename="report.pdf")

# Send location
client.messages.send_location(profile_id, to, latitude=-6.2088, longitude=106.8456)

# Send contact
client.messages.send_contact(profile_id, to, name="John Doe", phone="+6281234567890")

# Send poll
client.messages.send_poll(
    profile_id, to,
    question="What's your favorite color?",
    options=["Red", "Green", "Blue"]
)
```

### Broadcasts

```python
# Create broadcast
client.broadcasts.create(
    profile_id="...",
    name="Promo Campaign",
    recipients=["6281234567890", "6281234567891"],
    template_id="template-uuid"
)

# List broadcasts
broadcasts = client.broadcasts.list(profile_id)
```

### Contacts

```python
# Create contact
client.contacts.create(
    profile_id="...",
    phone="6281234567890",
    name="John Doe",
    tags=["customer", "vip"]
)

# List contacts
contacts = client.contacts.list(profile_id)
```

### Webhooks

```python
# Create webhook
client.webhooks.create(
    profile_id="...",
    url="https://your-webhook.com/whatsapp",
    events=["message.received", "message.sent"]
)
```

## Async Support

```python
import asyncio
from multiwa import AsyncMultiWA

async def main():
    client = AsyncMultiWA(
        base_url="https://your-multiwa-instance.com/api",
        api_key="your-api-key"
    )
    
    result = await client.messages.send_text(
        profile_id="...",
        to="6281234567890",
        text="Hello async!"
    )
    print(result)

asyncio.run(main())
```

## License

MIT - See [LICENSE](LICENSE) for details.

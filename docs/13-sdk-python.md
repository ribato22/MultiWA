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

# Initialize client
client = MultiWA(
    base_url="http://localhost:3001/api",
    api_key="YOUR_API_KEY"
)

# Send a text message
result = client.messages.send_text(
    profile_id="profile-123",
    to="628123456789",
    text="Hello from Python!"
)

print(f"Message sent: {result.message_id}")
```

---

## Async Client

```python
from multiwa import AsyncMultiWA
import asyncio

async def main():
    client = AsyncMultiWA(
        base_url="http://localhost:3001/api",
        api_key="YOUR_API_KEY"
    )

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
# Text
client.messages.send_text(profile_id, to, text)

# Image
client.messages.send_image(profile_id, to, url, caption=None)

# Video
client.messages.send_video(profile_id, to, url, caption=None)

# Document
client.messages.send_document(profile_id, to, url, filename)

# Location
client.messages.send_location(profile_id, to, latitude, longitude, description=None)

# Contact
client.messages.send_contact(profile_id, to, name, phone)

# Poll
client.messages.send_poll(profile_id, to, question, options, allow_multiple=False)
```

### Contacts

```python
# List
contacts = client.contacts.get_all(profile_id)

# Create
contact = client.contacts.create(profile_id, phone, name, tags=[])

# Update
client.contacts.update(contact_id, name=None, tags=None)

# Delete
client.contacts.delete(contact_id)
```

### Broadcasts

```python
# Create campaign
campaign = client.broadcasts.create(
    profile_id="profile-123",
    name="Promo Campaign",
    message="Hello {name}!",
    recipients=["628123456789", "628987654321"]
)

# Start broadcast
client.broadcasts.start(campaign.id)

# Get statistics
stats = client.broadcasts.get_stats(campaign.id)
```

### Profiles

```python
# List
profiles = client.profiles.get_all()

# Create
profile = client.profiles.create(name="My WhatsApp")

# Get QR
qr = client.profiles.get_qr(profile.id)

# Connect
client.profiles.connect(profile.id)

# Disconnect
client.profiles.disconnect(profile.id)
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

[← Automation](./12-automation.md) · [Documentation Index](./README.md) · [PHP SDK →](./14-sdk-php.md)

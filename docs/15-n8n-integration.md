# 15 - n8n Integration

Use MultiWA with n8n for powerful workflow automation.

---

## Installation

### n8n Community Nodes

```bash
npm install n8n-nodes-multiwa
```

Or install via n8n UI:
1. Go to **Settings** → **Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-multiwa`
4. Click **Install**

---

## Setup Credentials

1. In n8n, go to **Credentials** → **Add Credential**
2. Search for **MultiWA API**
3. Enter:
   - **API Base URL**: `http://localhost:3001/api`
   - **API Key**: Your MultiWA API key

---

## Available Nodes

### MultiWA Node

Send WhatsApp messages with 7 operations:

| Operation | Description |
|-----------|-------------|
| Send Text | Send a text message |
| Send Image | Send an image with caption |
| Send Video | Send a video with caption |
| Send Document | Send a document/file |
| Send Location | Send a location pin |
| Send Contact | Send a contact card |
| Send Poll | Send a poll with options |

### MultiWA Trigger

Receive WhatsApp events in real-time:

| Event | Description |
|-------|-------------|
| Message Received | Incoming message |
| Message Sent | Outgoing message confirmation |
| Message Delivered | Delivery confirmation |
| Message Read | Read receipt |
| Connection Changed | Session status change |

---

## Example Workflows

### Auto-Reply Bot

1. **Trigger**: MultiWA Trigger (Message Received)
2. **IF**: Check if message contains "help"
3. **MultiWA Node**: Send Text reply

```
[MultiWA Trigger] → [IF] → [MultiWA Send Text]
```

### AI Customer Support

1. **Trigger**: MultiWA Trigger (Message Received)
2. **OpenAI Node**: Generate response
3. **MultiWA Node**: Send Text reply

```
[MultiWA Trigger] → [OpenAI] → [MultiWA Send Text]
```

### Order Notification

1. **Webhook**: Receive order from e-commerce
2. **MultiWA Node**: Send order confirmation
3. **MultiWA Node**: Send invoice PDF

```
[Webhook] → [MultiWA Text] → [MultiWA Document]
```

### Lead Capture

1. **Trigger**: MultiWA Trigger (Message Received)
2. **Google Sheets**: Add contact
3. **MultiWA Node**: Send welcome message

```
[MultiWA Trigger] → [Google Sheets] → [MultiWA Send Text]
```

---

## Node Configuration

### Send Text

| Parameter | Description |
|-----------|-------------|
| Profile ID | WhatsApp profile to use |
| To | Recipient phone number |
| Text | Message content |

### Send Image

| Parameter | Description |
|-----------|-------------|
| Profile ID | WhatsApp profile |
| To | Recipient |
| Image URL | Direct link to image |
| Caption | Optional caption |

### Trigger

| Parameter | Description |
|-----------|-------------|
| Event | Event type to listen for |
| Profile ID | Filter by profile (optional) |

---

## Tips

1. **Use expressions** for dynamic content: `{{ $json.customer_name }}`
2. **Error handling**: Add Error Trigger for failed messages
3. **Rate limiting**: Add Wait node between bulk sends
4. **Logging**: Use n8n's execution history

---

[← PHP SDK](./14-sdk-php.md) · [Documentation Index](./README.md) · [Docker Deployment →](./16-deployment-docker.md)

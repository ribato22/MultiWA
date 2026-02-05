# n8n-nodes-multiwa

Custom n8n community nodes for [MultiWA](https://github.com/ribato22/multiwa) - WhatsApp Business API Gateway.

## Features

### MultiWA Node (Actions)
- **Send Text Message** - Send text messages to WhatsApp numbers
- **Send Image** - Send image messages with optional caption
- **Send Video** - Send video messages with optional caption
- **Send Document** - Send files and documents
- **Send Location** - Send location coordinates
- **Send Contact** - Send contact cards (vCard)
- **Send Poll** - Send interactive polls
- **Get Message** - Retrieve message details
- **List Messages** - List messages by profile

### MultiWA Trigger Node
- **Message Received** - Trigger when new message is received
- **Message Sent** - Trigger when message is sent
- **Message Delivered** - Trigger when message is delivered
- **Message Read** - Trigger when message is read
- **Connection Status** - Trigger on WhatsApp connection changes

## Installation

### Community Nodes (Recommended)

1. Go to **Settings > Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-multiwa`
4. Click **Install**

### Manual Installation

```bash
cd ~/.n8n/custom
npm install n8n-nodes-multiwa
```

## Configuration

1. Create a new credential of type **MultiWA API**
2. Enter your MultiWA instance URL (e.g., `https://your-instance.com/api`)
3. Enter your API Key

## Usage Examples

### Send Welcome Message

```json
{
  "nodes": [
    {
      "name": "MultiWA",
      "type": "n8n-nodes-multiwa.multiWA",
      "parameters": {
        "operation": "sendText",
        "profileId": "your-profile-id",
        "to": "6281234567890",
        "text": "Welcome to our service!"
      }
    }
  ]
}
```

### Auto-Reply to Messages

Use the **MultiWA Trigger** node to receive incoming messages, then use the **MultiWA** node to send automated replies.

## License

MIT

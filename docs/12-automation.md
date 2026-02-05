# 12 - Automation

## Overview

MultiWA provides powerful automation capabilities:

- **Auto-Reply**: AI-powered automatic responses
- **Visual Flow Builder**: Drag-and-drop workflow designer
- **Scheduled Messages**: Time-based sending

---

## Auto-Reply

### AI-Powered Replies

```bash
POST /api/autoreply/rules
{
  "profileId": "profile-123",
  "name": "Support Bot",
  "trigger": {
    "type": "keyword",
    "pattern": "help|support|bantuan"
  },
  "action": {
    "type": "ai_reply",
    "systemPrompt": "You are a helpful customer support agent for our company. Be friendly and concise.",
    "model": "gpt-4"
  },
  "isActive": true
}
```

### Keyword-Based Replies

```bash
POST /api/autoreply/rules
{
  "profileId": "profile-123",
  "name": "Price List",
  "trigger": {
    "type": "exact",
    "pattern": "harga|price"
  },
  "action": {
    "type": "send_message",
    "content": "Here is our price list:\n1. Basic: $10\n2. Pro: $25\n3. Enterprise: $99"
  }
}
```

---

## Visual Flow Builder

Create complex automation workflows visually:

### Node Types

| Node | Description |
|------|-------------|
| **Trigger** | Starts the flow (message, keyword, schedule) |
| **Condition** | Branches based on message content |
| **Action** | Performs an action (send, tag, AI) |
| **Delay** | Waits before next step |

### Example Flow

```
[Message Received] 
    → [Contains "order"?]
        → Yes → [Send Order Confirmation] → [Add Tag "customer"]
        → No  → [AI Reply]
```

### API

```bash
# List flows
GET /api/automation/flows?profileId=xxx

# Create flow
POST /api/automation/flows
{
  "profileId": "profile-123",
  "name": "Order Flow",
  "nodes": [...],
  "edges": [...]
}

# Activate/deactivate
PATCH /api/automation/flows/:id
{
  "isActive": true
}
```

---

## Scheduled Messages

```bash
POST /api/messages/schedule
{
  "profileId": "profile-123",
  "to": "628123456789",
  "text": "Happy Birthday!",
  "scheduledAt": "2026-02-14T00:00:00Z"
}
```

---

[← Groups](./11-groups.md) · [Documentation Index](./README.md) · [Python SDK →](./13-sdk-python.md)

---
sidebar_position: 3
title: "Automation"
---

# 12 - Automation

## Overview

All paths use the global `/api/v1` prefix (Docker default base URL: `http://localhost:3333/api/v1`). Endpoints below are source-verified from `apps/api/src/modules/autoreply/autoreply.controller.ts` and `apps/api/src/modules/automation/automation.controller.ts`.

MultiWA provides three layers of automation:

- **Auto-Reply** — keyword, exact, or AI-generated replies driven by an incoming message.
- **Visual Flow Builder** — drag-and-drop multi-step workflows on top of the same engine.
- **Scheduled Messages** — time-based sending via the messages module.

---

## Auto-Reply

The auto-reply controller is mounted at `/autoreply`. Rules live directly under that prefix — there is no `/rules` segment.

### Create an AI-Powered Rule

```bash
POST /api/v1/autoreply
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

### Create a Keyword-Based Rule

```bash
POST /api/v1/autoreply
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

### Manage Rules

```bash
# List
GET    /api/v1/autoreply

# Get one
GET    /api/v1/autoreply/:id

# Update
PUT    /api/v1/autoreply/:id

# Delete
DELETE /api/v1/autoreply/:id

# Toggle active flag
PUT    /api/v1/autoreply/:id/toggle
```

### Quick Replies

A separate sub-resource for canned replies surfaced in the Admin UI:

```bash
POST   /api/v1/autoreply/quick-replies
GET    /api/v1/autoreply/quick-replies
DELETE /api/v1/autoreply/quick-replies/:id
```

### Webhook-Driven and AI-Hook Replies

For more advanced setups you can wire an HTTP webhook or an AI hook per profile:

```bash
POST /api/v1/autoreply/webhook-reply
GET  /api/v1/autoreply/webhook-reply/:profileId

POST /api/v1/autoreply/ai-hook
GET  /api/v1/autoreply/ai-hook/:profileId
```

---

## Visual Flow Builder

Create complex automation workflows visually. The controller is mounted at `/automation`; flows live directly under that prefix — there is no `/flows` segment.

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
# Create flow
POST   /api/v1/automation
{
  "profileId": "profile-123",
  "name": "Order Flow",
  "nodes": [...],
  "edges": [...]
}

# List flows (filter by profile via query string)
GET    /api/v1/automation?profileId=xxx

# Get one
GET    /api/v1/automation/:id

# Update
PUT    /api/v1/automation/:id

# Delete
DELETE /api/v1/automation/:id

# Toggle active flag
PUT    /api/v1/automation/:id/toggle

# Test a flow with a sample payload
POST   /api/v1/automation/:id/test

# Read execution stats
GET    /api/v1/automation/:id/stats

# Reorder flows
POST   /api/v1/automation/reorder
```

---

## Scheduled Messages

Scheduling is part of the messages module, not the automation module:

```bash
# Schedule
POST   /api/v1/messages/schedule
{
  "profileId": "profile-123",
  "to": "628123456789",
  "text": "Happy Birthday!",
  "scheduledAt": "2026-02-14T00:00:00Z"
}

# List scheduled messages for a profile
GET    /api/v1/messages/schedule/:profileId

# Cancel a scheduled message
DELETE /api/v1/messages/schedule/:id
```

---

[← Groups](<groups.md>) · [Documentation Index](<../intro.md>) · [Python SDK →](<../sdks/python-sdk.md>)

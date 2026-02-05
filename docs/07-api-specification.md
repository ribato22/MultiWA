# 07 - API Specification

## 7.1 Overview

| Property | Value |
|----------|-------|
| Base URL | `http://localhost:3001/api` |
| API Version | v1 |
| Format | JSON |
| Auth | Bearer Token or X-API-Key header |

---

## 7.2 Authentication

### Bearer Token
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### API Key
```
X-API-Key: YOUR_API_KEY
```

---

## 7.3 Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-02-05T10:00:00Z" }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Phone number is required"
  }
}
```

---

## 7.4 Endpoints

### Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/messages/text` | Send text message |
| `POST` | `/messages/image` | Send image |
| `POST` | `/messages/video` | Send video |
| `POST` | `/messages/document` | Send document |
| `POST` | `/messages/location` | Send location |
| `POST` | `/messages/contact` | Send contact card |
| `POST` | `/messages/poll` | Send poll |

### Bulk Messaging

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/bulk/send` | Send bulk messages with variables |
| `GET` | `/bulk/batches` | List all batches |
| `GET` | `/bulk/batch/:batchId` | Get batch status |
| `POST` | `/bulk/batch/:batchId/cancel` | Cancel batch |

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/groups/profile/:profileId` | List all groups |
| `GET` | `/groups/:groupId` | Get group info |
| `POST` | `/groups` | Create group |
| `PATCH` | `/groups/:groupId` | Update group |
| `POST` | `/groups/:groupId/participants/add` | Add participants |
| `POST` | `/groups/:groupId/participants/remove` | Remove participants |
| `POST` | `/groups/:groupId/participants/promote` | Promote to admin |
| `POST` | `/groups/:groupId/participants/demote` | Demote from admin |
| `POST` | `/groups/:groupId/leave` | Leave group |
| `GET` | `/groups/:groupId/invite-link` | Get invite link |

### Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/profiles` | List all profiles |
| `POST` | `/profiles` | Create profile |
| `GET` | `/profiles/:id` | Get profile |
| `DELETE` | `/profiles/:id` | Delete profile |
| `POST` | `/profiles/:id/connect` | Start connection |
| `GET` | `/profiles/:id/qr` | Get QR code |
| `POST` | `/profiles/:id/disconnect` | Disconnect |

### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/contacts` | List contacts |
| `POST` | `/contacts` | Create contact |
| `GET` | `/contacts/:id` | Get contact |
| `PATCH` | `/contacts/:id` | Update contact |
| `DELETE` | `/contacts/:id` | Delete contact |
| `POST` | `/contacts/:id/tags` | Add tags |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/webhooks` | List webhooks |
| `POST` | `/webhooks` | Create webhook |
| `DELETE` | `/webhooks/:id` | Delete webhook |

---

## 7.5 Example: Send Bulk with Variables

```bash
curl -X POST http://localhost:3001/api/bulk/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "profileId": "profile-123",
    "messages": [
      {
        "chatId": "628123456789@c.us",
        "type": "text",
        "content": { "text": "Hello {name}!" },
        "variables": { "name": "John" }
      },
      {
        "chatId": "628987654321@c.us",
        "type": "text",
        "content": { "text": "Hello {name}!" },
        "variables": { "name": "Jane" }
      }
    ],
    "options": {
      "delayBetweenMessages": 5000,
      "randomizeDelay": true
    }
  }'
```

---

[← Engine Abstraction](./06-engine-abstraction.md) · [Documentation Index](./README.md) · [WebSocket API →](./08-websocket-api.md)

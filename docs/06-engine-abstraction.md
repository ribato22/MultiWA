# 06 - Engine Abstraction

## Overview

MultiWA supports multiple WhatsApp client libraries through an abstraction layer.

---

## Supported Engines

| Engine | Status | Description |
|--------|--------|-------------|
| **Baileys** | ✅ Default | Pure Node.js, fastest |
| **WhatsApp-Web.js** | ✅ Supported | Puppeteer-based, more stable |

---

## Engine Interface

```typescript
interface IWhatsAppEngine {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): SessionStatus;
  
  // Messages
  sendText(to: string, text: string): Promise<MessageResult>;
  sendImage(to: string, url: string, caption?: string): Promise<MessageResult>;
  sendVideo(to: string, url: string, caption?: string): Promise<MessageResult>;
  sendDocument(to: string, url: string, filename: string): Promise<MessageResult>;
  
  // Groups
  getGroups(): Promise<GroupInfo[]>;
  getGroupInfo(groupId: string): Promise<GroupInfo>;
  createGroup(name: string, participants: string[]): Promise<GroupInfo>;
  addGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  removeGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  
  // Events
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
}
```

---

## Configuration

```typescript
// .env
ENGINE_TYPE=baileys  // or whatsapp-web.js

// Per-profile override
{
  "profileId": "abc123",
  "engine": "WHATSAPP_WEB_JS"
}
```

---

## Event Flow

```
Engine Event → EngineManager → EventsGateway → WebSocket/Webhook
     ↓
  Prisma DB
```

---

## Adding New Engines

1. Implement `IWhatsAppEngine` interface
2. Register in `EngineFactory`
3. Add to `EngineType` enum in Prisma

---

[← Database Design](./05-database-design.md) · [Documentation Index](./README.md) · [API Specification →](./07-api-specification.md)

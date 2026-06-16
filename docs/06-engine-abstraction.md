# 06 - Engine Abstraction

## Overview

MultiWA supports multiple WhatsApp client libraries through an abstraction layer.

---

## Supported Engines

| Engine | Key | Status | Notes |
|--------|-----|--------|-------|
| **WhatsApp-Web.js** | `whatsapp-web-js` | ✅ Default (production) | Puppeteer-based, most stable, best group support |
| **Baileys** | `baileys` | ⚠️ Experimental | Pure Node.js; `sendReaction` is a no-op stub and `getContacts` may be unavailable — not validated for production |
| **Mock** | `mock` | 🧪 Testing only | Simulated adapter for local/dev and tests |

Each `Profile` has an `engine` column selecting its adapter. The engine is
instantiated through `EngineFactory.create()` when the profile connects.

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

Engine selection precedence (resolved in `EngineManagerService.resolveEngineType`):

1. The profile's `engine` field (validated: `whatsapp-web-js` | `baileys` | `mock`)
2. The `DEFAULT_ENGINE` environment variable (if a valid engine key)
3. `whatsapp-web-js` (fallback)

```bash
# .env — default engine for profiles that don't set one explicitly
# Options: whatsapp-web-js (default) | baileys (EXPERIMENTAL) | mock (testing only)
DEFAULT_ENGINE=whatsapp-web-js
```

```jsonc
// Per-profile selection — POST/PUT /profiles
{
  "engine": "whatsapp-web-js"
}
```

> Changing a profile's engine takes effect on the **next reconnect**; the API
> returns a warning when the engine changes. Clear the engine-specific session
> directory (`.wwebjs_auth` for whatsapp-web-js, `creds.json` for Baileys) before
> reconnecting to avoid a stale session.

---

## Event Flow

```
Engine Event → EngineManager → EventsGateway → WebSocket/Webhook
     ↓
  Prisma DB
```

---

## Adding New Engines

1. Implement the `IWhatsAppEngine` interface (`packages/engines`)
2. Register the new key in `EngineFactory.create()`
3. Add the key to the `EngineType` union (`packages/engines/src/types.ts`) and the
   `EngineType` DTO enum (`apps/api/.../profiles/dto`). The Prisma `Profile.engine`
   column is a plain `String`, so no schema enum change is needed.

---

[← Database Design](./05-database-design.md) · [Documentation Index](./README.md) · [API Specification →](./07-api-specification.md)

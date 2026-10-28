---
sidebar_position: 3
title: "Engine Abstraction"
---

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

### Calls

Engines report incoming WhatsApp calls through two callbacks of `EngineConfig`, and can reject a call and create a call link. The types are in `packages/engines/src/types.ts`:

```typescript
type CallState = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended';
type CallLogOutcome = 'missed' | 'rejected' | 'answered_elsewhere';
type CallLinkType = 'voice' | 'video';

interface IncomingCall {
  id: string;          // engine call id, passed back to rejectCall
  from: string;        // caller JID as the engine reports it (@c.us, @s.whatsapp.net or @lid); may be empty after 'ringing'
  isVideo: boolean;
  isGroup: boolean;
  state?: CallState;   // absent = 'ringing'
}

interface CallLogEntry {
  messageId: string;   // the call-log message id (dedupe key)
  callId?: string;     // the engine call id, when the message id carries it
  from: string;
  isVideo: boolean;
  outcome: CallLogOutcome;
  timestamp: Date;
}

// EngineConfig
onCall?: (call: IncomingCall) => void;
onCallLog?: (entry: CallLogEntry) => void;   // WhatsApp's call-log message: the call's final outcome

// IWhatsAppEngine
rejectCall(callId: string): Promise<void>;                   // rejects when the call is not ringing any more
createCallLink(type: CallLinkType): Promise<string | null>;  // null = this engine has no call-link API
```

| | whatsapp-web.js | Baileys |
|---|---|---|
| `onCall` | `ringing`, and `ended` once the call stops being the active call. Its live events cannot tell how a call ended | `ringing`, `accepted` (answered on another device of the account), `rejected` (declined on the phone or by MultiWA), `missed` (the offer rang out) and `ended` (any other end of the call; how it ended is not known) |
| `onCallLog` | `missed`, `rejected` or `answered_elsewhere`, from WhatsApp's call-log message, usually moments after `ended`. Only for a call it reported `ringing` since it last connected: the old call logs a freshly linked device syncs are ignored | Never called |
| `createCallLink` | A WhatsApp call link | `null`: the Baileys version MultiWA pins has no call-link API |

Match a call by `id`: `from`, `isVideo` and `isGroup` are reliable on `ringing` and best effort on later states. A call-log message is matched to its call by `callId`, and by caller and time when it carries none.

- `rejectCall` rejects with `Call is not ringing any more` when the engine no longer holds the call (it ended, was answered or was rejected); the API answers `409` for that text.
- A call link is a plain link: anyone who has it can join, without approval.
- A call that rang while the profile was offline: whatsapp-web.js gets no live event for it and ignores its call log, so it is never recorded. Baileys delivers it as a normal `ringing` offer (its own `offline` flag is not passed on), so it is handled like any other.
- Answering and placing calls are not supported.

Storing the calls and publishing the `call.*` [webhook events](<../api/webhook-events.md#call-events>) is done once, in the shared runtime (`packages/engine-runtime`), so an engine only has to report.

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

[← Database Design](<database-design.md>) · [Documentation Index](<../intro.md>) · [API Specification →](<../api/api-specification.md>)

---
sidebar_position: 2
title: "WebSocket API"
---

# 08 - WebSocket API

Real-time events over Socket.IO: the QR code while a profile links, connection status, incoming messages, delivery acks and calls. The server is Socket.IO, so connect with a Socket.IO client (`socket.io-client` 4.x, `python-socketio`, …); a plain `WebSocket` cannot talk to it.

---

## 8.1 Connection

| Setting | Value |
|---------|-------|
| URL | The API origin plus the namespace `/ws`: `http://localhost:3333/ws` with the Docker defaults, `https://wa.example.com/ws` behind the bundled nginx |
| Socket.IO path | `/socket.io/`, the default (the bundled nginx proxies it to the API) |
| Transports | `websocket` and `polling` |
| Browser origins | Must be listed in `CORS_ORIGINS` |

Credentials go in the handshake, as one of:

- **JWT** — the `accessToken` from `POST /api/v1/auth/login`: `auth: { token }`, an `Authorization: Bearer <token>` header, or `?token=`.
- **API key** — `auth: { apiKey }`, an `X-API-Key` header, or `?apiKey=`.

The user must be active, a JWT's login session must still be live (as on the REST API, logging out or revoking the session ends it), and an API key must not have expired. API-key scopes are not checked here: any valid key of the organization can listen.

A socket without valid credentials is accepted and then disconnected at once: the client sees `connect`, then `disconnect` with the reason `io server disconnect`. Socket.IO does not reconnect by itself after that reason; call `socket.connect()` once the credentials are fixed. The token is only checked in the handshake, so pass `auth` as a function when you use JWTs: every reconnect then sends the current token instead of an expired one. Its session is checked again every minute: a JWT socket whose session was logged out, revoked or has expired, or whose user was deactivated, is disconnected the same way, so a revoked device stops receiving calls within a minute.

---

## 8.2 Choosing profiles

Events are sent per profile, to the sockets that joined it. After every `connect` (rooms do not survive a reconnect), join each profile you want:

| Client emits | Body | Acknowledgement |
|--------------|------|-----------------|
| `join` (alias `subscribe:profile`) | `{ "profileId": "…" }` | `{ "success": true, "profileId": "…" }`, or `{ "success": false, "error": "Forbidden" }` when the profile is not in your organization |
| `unsubscribe:profile` | `{ "profileId": "…" }` | `{ "success": true, "profileId": "…" }` |

A joined socket receives every event of that profile; there is no per-event filter. Socket.IO keeps the connection alive itself, so there is no application-level ping.

---

## 8.3 Events

| Event | Sent when | Payload |
|-------|-----------|---------|
| `qr:update` | A new QR code is shown while the profile links | `{ profileId, qrCode }` |
| `connection:status` | The engine connects, disconnects, retries or fails | `{ profileId, status, phoneNumber?, phone?, reason? }` |
| `message` | An incoming message was stored | `{ type: "message:received", message, conversation }` |
| `message:ack` | WhatsApp reports a new status for an outgoing message | `{ profileId, messageId, status }` |
| `call:update` | An incoming call rings, is rejected or ends, or its outcome, follow-up or assignee changes | The call, plus `profileId` |
| `call:ringing`, `call:claimed`, `call:active`, `call:ended`, `call:availability` | Calls answered in the dashboard (below) | See below |

### qr:update

`qrCode` is a PNG data URL (`data:image/png;base64,…`) to put in an `<img>`; if rendering the image failed it is the raw QR text instead. A new code replaces the previous one every 20 seconds or so until it is scanned.

### connection:status

| `status` | Meaning |
|----------|---------|
| `connected` | Ready to send and receive. `phoneNumber` holds the number; `phone` repeats it for older clients |
| `disconnected` | The engine stopped: logged out, closed, or a QR that was not scanned in time |
| `reconnecting (n/max)` | An automatic reconnect attempt, e.g. `reconnecting (2/5)` |
| `error` | With `reason`: the scanned number is not this profile's number, and the link was undone. Without `reason`: the engine failed to start |

```json
{ "profileId": "0b6c1e1a-3f5a-4c1e-9a52-7d1f5c3e8b41", "status": "connected", "phoneNumber": "628123456789", "phone": "628123456789" }
```

### message

Incoming messages only; what you send is not echoed. `message` is the stored message and `conversation` the conversation it belongs to (abridged):

```json
{
  "type": "message:received",
  "message": {
    "id": "5d0c9a8e-2b1f-4a77-9c3e-1f2a3b4c5d6e",
    "profileId": "0b6c1e1a-3f5a-4c1e-9a52-7d1f5c3e8b41",
    "conversationId": "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4",
    "messageId": "false_628123456789@c.us_3EB0ABC123",
    "direction": "incoming",
    "senderJid": "628123456789@s.whatsapp.net",
    "type": "text",
    "content": { "text": "Hello!" },
    "status": "received",
    "timestamp": "2026-10-28T10:00:00.000Z"
  },
  "conversation": {
    "id": "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4",
    "jid": "628123456789@s.whatsapp.net",
    "name": "Budi",
    "type": "user",
    "unreadCount": 1
  }
}
```

### message:ack

`messageId` is the WhatsApp message id: the `messageId` field of the stored message (not its `id`), which a direct send also returns as `waMessageId`. A queued send (`status: "queued"`) gets its WhatsApp id only once it goes out, so match those through the stored message. `status` is one of `pending`, `sent`, `delivered`, `read`, `played` (a voice note was played) or `failed`.

```json
{ "profileId": "0b6c1e1a-3f5a-4c1e-9a52-7d1f5c3e8b41", "messageId": "true_628123456789@c.us_3EB0DEF456", "status": "read" }
```

### call:update

The call with the same fields as the `data` of the [`call.*` webhooks](<webhook-events.md#call-events>) (`callId`, `from`, `outcome`, `followUp`, …), plus `profileId`. It is sent on every change, so keep the newest one per `callId`.

### Calls answered in the dashboard

When a profile has dashboard answering on (`PUT /profiles/:id/calls-settings`), its incoming calls ring the agents online on `/ws`: every active owner, admin and member of its organization who is available and not on a call. These events go to all of an agent's sockets, whatever profiles they subscribed to. Every command is acked `{ ok: true, … }` or `{ ok: false, reason }`; besides each command's own reasons, any command can answer `error` (it failed on the server). Calls are answered in the dashboard: only dashboard logins (JWT) are rung, count as online, and may send these commands. A socket on an API key gets none of these events, and its commands are refused.

| Direction | Event | Payload / ack |
|---|---|---|
| server → agent | `call:ringing` | `{ callId, profileId, profileName, caller: { name, number }, startedAt, answerable, unavailableReason? }`. `answerable: false`: answer on the phone; `unavailableReason` says why |
| server → agent | `call:claimed` | `{ callId, byUserId, byUserName }`: another agent answered |
| server → agent | `call:ended` | `{ callId, outcome }` when the call stopped ringing; for the agent's own call `{ callId, endedBy, endReason, talkSeconds }`, or `{ callId, endReason }` (`media_failed` or `cancelled`) when it ended before its audio connected |
| server → agent | `call:active` | `{ callId, answeredAt }`: the agent is on the call |
| server → agent | `call:availability` | `{ available }`, to all of the agent's tabs when it changes |
| client → server | `call:answer` | `{ callId }` → `{ ok: true, callId, callerProducerId, iceServers }`, or a reason: `not_allowed`, `not_ringing`, `already_claimed`, `busy`, `media_unavailable`, `media_failed` |
| client → server | `call:media` | `{ callId, op, … }`, mediasoup signalling (`rtpCapabilities`, `createTransport`, `connectTransport`, `produce`, `consume`, `resumeConsumer`, `closeConsumer`) → `{ ok: true, result }`, or a reason: `not_allowed`, `not_in_call`, `media_error` (with `message`) |
| client → server | `call:rejoin` | `{ callId }` after a page reload → like `call:answer` |
| client → server | `call:hangup` | `{ callId }` → `{ ok: true }` |
| client → server | `call:availability` | `{ available }` → `{ ok: true, available }`, or `not_allowed`, or `invalid` when `available` is not a boolean |

The agent's audio must connect within `CALLS_CONNECT_TIMEOUT_MS` of the answer, or the answer is undone (`call:ended` with `endReason: media_failed`) and the call rings again, unless WhatsApp was already answering it: it is hung up then. An agent with no socket, or whose audio link is down, for `CALLS_AGENT_GRACE_MS` is hung up (`endReason: agent_lost`).

---

## 8.4 Example (Node.js)

```javascript
import { io } from 'socket.io-client';

const profileId = 'YOUR_PROFILE_ID';
const socket = io('http://localhost:3333/ws', {
  auth: { apiKey: process.env.MULTIWA_API_KEY },
  transports: ['websocket'],
});

socket.on('connect', () => {
  socket.emit('join', { profileId }, (res) => {
    if (!res?.success) console.error('join refused:', res?.error);
  });
});
socket.on('disconnect', (reason) => console.log('disconnected:', reason)); // 'io server disconnect' = bad credentials

socket.on('message', ({ message, conversation }) => console.log(conversation.jid, message.content));
socket.on('message:ack', ({ messageId, status }) => console.log(messageId, status));
socket.on('connection:status', ({ status, phoneNumber, reason }) => console.log(status, phoneNumber ?? reason ?? ''));
socket.on('qr:update', ({ qrCode }) => { /* show qrCode (a data URL) in an <img> */ });
socket.on('call:update', (call) => console.log(call.callId, call.outcome));
```

In a browser with a JWT, read the token at every (re)connect:

```javascript
const socket = io('https://wa.example.com/ws', {
  auth: (cb) => cb({ token: localStorage.getItem('accessToken') }),
});
```

---

## 8.5 WebSocket or webhooks

The socket is for live screens. It keeps nothing for you: an event sent while you were disconnected is gone, so read the REST API after a reconnect. For server-to-server delivery with retries and HMAC signatures, use [webhooks](<webhook-events.md>).

With `ENGINE_HOST=worker` the worker produces these events and the API forwards them to the same sockets, with the same names and payloads.

---

[← API Specification](<api-specification.md>) · [Documentation Index](<../intro.md>) · [Webhook Events →](<webhook-events.md>)

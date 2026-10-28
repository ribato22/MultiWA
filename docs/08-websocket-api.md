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

The user must be active and an API key must not have expired. API-key scopes are not checked here: any valid key of the organization can listen.

A socket without valid credentials is accepted and then disconnected at once: the client sees `connect`, then `disconnect` with the reason `io server disconnect`. Socket.IO does not reconnect by itself after that reason; call `socket.connect()` once the credentials are fixed. The token is only checked in the handshake, so pass `auth` as a function when you use JWTs: every reconnect then sends the current token instead of an expired one.

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

The call with the same fields as the `data` of the [`call.*` webhooks](./09-webhook-events.md#call-events) (`callId`, `from`, `outcome`, `followUp`, …), plus `profileId`. It is sent on every change, so keep the newest one per `callId`.

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

The socket is for live screens. It keeps nothing for you: an event sent while you were disconnected is gone, so read the REST API after a reconnect. For server-to-server delivery with retries and HMAC signatures, use [webhooks](./09-webhook-events.md).

With `ENGINE_HOST=worker` the worker produces these events and the API forwards them to the same sockets, with the same names and payloads.

---

[← API Specification](./07-api-specification.md) · [Documentation Index](./README.md) · [Webhook Events →](./09-webhook-events.md)

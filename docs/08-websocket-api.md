# 08 - WebSocket API

Real-time event streaming via WebSocket.

---

## 8.1 Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?apiKey=YOUR_API_KEY');
```

### Connection Acknowledgment
```json
{
  "type": "ack",
  "payload": {
    "message": "Connected to MultiWA WebSocket API",
    "clientId": "abc123",
    "timestamp": "2026-02-05T10:00:00.000Z"
  }
}
```

---

## 8.2 Message Protocol

### Subscribe to Events
```json
{
  "type": "subscribe",
  "payload": {
    "profileId": "profile-123",
    "events": ["message.received", "session.status"]
  },
  "requestId": "req_001"
}
```

### Unsubscribe
```json
{
  "type": "unsubscribe",
  "requestId": "req_002"
}
```

### Keep-Alive Ping
```json
{
  "type": "ping",
  "requestId": "ping_001"
}
```

### Pong Response
```json
{
  "type": "pong",
  "payload": { "timestamp": "2026-02-05T10:00:00.000Z" },
  "requestId": "ping_001"
}
```

---

## 8.3 Event Types

| Event | Description |
|-------|-------------|
| `qr.updated` | New QR code generated |
| `session.status` | Connection status changed |
| `message.received` | Incoming message |
| `message.ack` | Message status (sent/delivered/read) |
| `*` | Subscribe to all events |

---

## 8.4 Event Payloads

### message.received
```json
{
  "type": "event",
  "payload": {
    "event": "message.received",
    "profileId": "profile-123",
    "data": {
      "id": "true_628xxx_3EB0ABC",
      "from": "628123456789@c.us",
      "body": "Hello!",
      "type": "chat",
      "timestamp": "2026-02-05T10:00:00.000Z",
      "hasMedia": false
    },
    "timestamp": "2026-02-05T10:00:00.000Z"
  }
}
```

### session.status
```json
{
  "type": "event",
  "payload": {
    "event": "session.status",
    "profileId": "profile-123",
    "data": {
      "status": "connected",
      "phone": "628123456789"
    },
    "timestamp": "2026-02-05T10:00:00.000Z"
  }
}
```

---

## 8.5 JavaScript Client Example

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?apiKey=YOUR_API_KEY');
let pingInterval;

ws.onopen = () => {
  console.log('Connected');
  
  // Subscribe to events
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: {
      profileId: 'profile-123',
      events: ['message.received', 'session.status']
    },
    requestId: 'sub_001'
  }));

  // Keep-alive ping every 30s
  pingInterval = setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping', requestId: `ping_${Date.now()}` }));
  }, 30000);
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'event') {
    console.log('Event:', msg.payload.event, msg.payload.data);
  } else if (msg.type === 'ack') {
    console.log('Ack:', msg.payload);
  }
};

ws.onclose = () => {
  if (pingInterval) clearInterval(pingInterval);
  console.log('Disconnected');
};
```

---

[← API Specification](./07-api-specification.md) · [Documentation Index](./README.md) · [Webhook Events →](./09-webhook-events.md)

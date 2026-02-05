# @multiwa/sdk

TypeScript SDK for MultiWA Gateway API

## Installation

```bash
npm install @multiwa/sdk
# or
pnpm add @multiwa/sdk
```

## Quick Start

```typescript
import { MultiWAClient } from '@multiwa/sdk';

const client = new MultiWAClient({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3000', // optional
});

// Send a text message
const message = await client.messages.sendText({
  profileId: 'profile-uuid',
  to: '628123456789',
  text: 'Hello from SDK!',
});

// Send media
await client.messages.sendImage({
  profileId: 'profile-uuid',
  to: '628123456789',
  url: 'https://example.com/image.jpg',
  caption: 'Check this out!',
});
```

## Features

### Messages

```typescript
// Text
await client.messages.sendText({ profileId, to, text });

// Image/Video/Audio/Document
await client.messages.sendImage({ profileId, to, url, caption });
await client.messages.sendVideo({ profileId, to, url, caption });
await client.messages.sendAudio({ profileId, to, url, ptt: true });
await client.messages.sendDocument({ profileId, to, url, filename });

// Location
await client.messages.sendLocation({ profileId, to, latitude, longitude, name });

// Contact Card
await client.messages.sendContact({
  profileId,
  to,
  contacts: [{ name: 'John', phone: '+1234567890' }],
});

// Reaction
await client.messages.sendReaction({ profileId, messageId, emoji: '👍' });
```

### Contacts

```typescript
// CRUD
const contact = await client.contacts.create({ profileId, phone, name, tags });
const contacts = await client.contacts.list(profileId, { search, tags });
await client.contacts.update(id, { name, tags });
await client.contacts.delete(id);

// Bulk operations
await client.contacts.import({ profileId, contacts: [...] });
await client.contacts.importCsv({ profileId, csvData });
const { csv } = await client.contacts.exportCsv(profileId);

// Tags
await client.contacts.addTags(id, ['vip', 'active']);
await client.contacts.removeTags(id, ['inactive']);

// Validation
const result = await client.contacts.validatePhone(profileId, '+628123456789');
```

### Templates

```typescript
const template = await client.templates.create({
  profileId,
  name: 'Welcome',
  content: { text: 'Hello {{name}}!' },
});

const preview = await client.templates.preview(id, { name: 'John' });
await client.templates.duplicate(id, 'Welcome Copy');
```

### Broadcasts

```typescript
// Create
const broadcast = await client.broadcasts.create({
  profileId,
  name: 'Promo Campaign',
  message: { type: 'text', text: 'Check our promo!' },
  recipients: { type: 'tags', value: ['customers'] },
});

// Schedule
await client.broadcasts.schedule(id, new Date('2026-02-14'));

// Control
await client.broadcasts.start(id);
await client.broadcasts.pause(id);
await client.broadcasts.resume(id);
await client.broadcasts.cancel(id);

// Stats
const stats = await client.broadcasts.getStats(id);
```

### Webhooks

```typescript
const webhook = await client.webhooks.create({
  profileId,
  url: 'https://your-server.com/webhook',
  events: ['message.received', 'message.sent'],
});

await client.webhooks.test(id);
const logs = await client.webhooks.getLogs(id);
```

### Automations

```typescript
const automation = await client.automations.create({
  profileId,
  name: 'Welcome Message',
  triggerType: 'keyword',
  triggerConfig: { keywords: ['hi', 'hello'], matchMode: 'contains' },
  actions: [{ type: 'reply', config: { text: 'Welcome!' } }],
});

// Test
const result = await client.automations.test(id, 'hi there');

// Toggle
await client.automations.toggle(id);
```

## Error Handling

```typescript
import { MultiWAClient, MultiWAError } from '@multiwa/sdk';

try {
  await client.messages.sendText({ ... });
} catch (error) {
  if (error instanceof MultiWAError) {
    console.log(error.message);     // Error message
    console.log(error.statusCode);  // HTTP status code
    console.log(error.details);     // Additional details
  }
}
```

## Configuration

```typescript
const client = new MultiWAClient({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3000',  // API server URL
  timeout: 30000,                     // Request timeout (ms)
  headers: {                          // Custom headers
    'X-Custom-Header': 'value',
  },
});
```

## License

MIT

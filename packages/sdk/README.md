# @multiwa/sdk

TypeScript SDK for the MultiWA Gateway API.

## Installation

The SDK is available in this repository today. Public registry publishing
(`@multiwa/sdk` on NPM) is tracked as a release follow-up and is **not yet
verified**, so do not assume `npm install @multiwa/sdk` resolves to this
package on the registry.

Until the registry release is verified, install from this repository:

```bash
# Inside the MultiWA monorepo, the SDK is already part of the workspace
pnpm install

# In an external project, install from a local path
pnpm add file:../multiwa/packages/sdk
# or directly from a git ref
pnpm add github:ribato22/MultiWA#main
```

## Quick Start

```typescript
import { MultiWAClient } from '@multiwa/sdk';

const client = new MultiWAClient({
  apiKey: 'your-api-key',
  // Required to point at the API prefix. Pick one:
  //   Local dev: http://localhost:3000/api/v1   (default if omitted)
  //   Docker:    http://localhost:3333/api/v1
  //   Prod:      https://your-host/api/v1
  baseUrl: 'http://localhost:3333/api/v1',
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
```

The API exposes no webhook delivery log, so `client.webhooks.getLogs()` is
deprecated and always rejects with an `Error`.

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
  baseUrl: 'http://localhost:3000/api/v1', // API base URL, including /api/v1
  timeout: 30000,                          // Request timeout (ms)
  headers: {                               // Custom headers
    'X-Custom-Header': 'value',
  },
});
```

## License

MIT

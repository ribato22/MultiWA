# @multiwa/sdk

TypeScript SDK for the MultiWA Gateway API.

## Installation

```bash
npm install @multiwa/sdk
```

Inside the MultiWA monorepo, the SDK is already part of the workspace (`pnpm install`).

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

### Calls

Incoming WhatsApp calls: the follow-up queue, the readiness of answering them in
the dashboard, the recordings and the announcement
([Calls answered in the dashboard](https://github.com/ribato22/MultiWA/blob/main/docs/23-calls.md)).

```typescript
import { readFile, writeFile } from 'node:fs/promises';

// A page of a profile's calls, newest first; pass nextCursor back for the next page
const page = await client.calls.list(profileId, { outcome: 'answered', limit: 50 });
if (page.nextCursor) await client.calls.list(profileId, { outcome: 'answered', cursor: page.nextCursor });

await client.calls.openCount();                              // { count }: the open follow-ups in the organization
const call = await client.calls.get(callId);                 // call.recording: null, or its facts
await client.calls.update(callId, { followUp: 'done' });     // or { assignedUserId: '…' }
await client.calls.update(callId, { assignedUserId: null }); // unassign
await client.calls.reject(callId);                           // a call that still rings
await client.calls.reply(callId, 'We will call you back');   // no text: the profile's default reply
await client.calls.sendCallLink(callId, 'voice', 'Tap to call us');

// Owners and admins
const status = await client.calls.mediaStatus();             // the server, its recordings storage, each profile
// Recording needs the announcement first: bytes, a Blob, or a File, which keeps its own name
await client.calls.uploadAnnouncement(profileId, await readFile('notice.mp3'), 'notice.mp3');
await client.calls.updateSettings(profileId, { answerInDashboard: true, recording: true, retentionDays: 30 });
const notice = await client.calls.getAnnouncement(profileId); // { data: Uint8Array, contentType }

const audio = await client.calls.getRecording(callId, { download: true }); // audio/webm
await writeFile(`call-${callId}.webm`, audio.data);
await client.calls.deleteRecording(callId);

await client.calls.updateSettings(profileId, { recording: false });
await client.calls.deleteAnnouncement(profileId);            // refused with 409 while recording is on
```

Everything above `// Owners and admins` is open to every user of the
organization; the rest is for owners and admins. An API key acts with its user's
role, and a key with a scope list also needs `messages:write` for `reply()` and
`sendCallLink()`, `recordings:read` to fetch a recording, `recordings:delete` to
delete one, and `profiles:write` for the settings and the announcement, with
`recordings:delete` too for `retentionDays`
([API keys](https://github.com/ribato22/MultiWA/blob/main/docs/23-calls.md#api-keys)).
The client's `timeout` covers a whole download: a long recording may need a
larger one.

The SDK has no realtime events for calls: answering is for people signed in to
the dashboard, and an API key never gets the agents' events. Follow calls with
the `call.*` [webhooks](https://github.com/ribato22/MultiWA/blob/main/docs/09-webhook-events.md#call-events),
or the [WebSocket](https://github.com/ribato22/MultiWA/blob/main/docs/08-websocket-api.md#callupdate)
`call:update` event.

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

A calls setting that cannot be turned on is refused with 409, and `details.reasons`
says why:

```typescript
try {
  await client.calls.updateSettings(profileId, { recording: true });
} catch (error) {
  if (error instanceof MultiWAError && error.statusCode === 409) {
    console.log(error.details.reasons); // e.g. ['no_announcement']
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

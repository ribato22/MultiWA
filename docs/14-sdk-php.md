# 14 - PHP SDK

Official PHP SDK for MultiWA: the Composer package `multiwa/multiwa-php`, source in [`packages/sdk-php`](https://github.com/ribato22/MultiWA/tree/main/packages/sdk-php).

---

## Installation

```bash
composer require multiwa/multiwa-php
```

To try a change that is not released yet, install from a clone of this repository with a Composer `path` repository:

```json
{
  "repositories": [{ "type": "path", "url": "../MultiWA/packages/sdk-php" }],
  "require": { "multiwa/multiwa-php": "*" }
}
```

---

## Requirements

- PHP 8.1+
- Guzzle 7.5+ (installed with the SDK)

---

## Quick Start

```php
<?php

require_once 'vendor/autoload.php';

use MultiWA\MultiWA;

// baseUrl includes the API prefix /api/v1
$client = new MultiWA(
    baseUrl: 'http://localhost:3333/api/v1',
    apiKey: 'YOUR_API_KEY',
);

$result = $client->messages()->sendText(
    profileId: 'profile-123',
    to: '628123456789',
    text: 'Hello from PHP!',
);

echo "Message ID: " . $result->messageId;
```

`baseUrl` is `http://localhost:3333/api/v1` with the Docker defaults, `http://localhost:3000/api/v1` in local development, and `https://your-host/api/v1` in production. The constructor also takes `timeout` (seconds, default 30) and `handler`, a Guzzle handler for tests (see [Testing](#testing)).

---

## API Reference

### Messages

`to` is a phone number with country code (`628123456789`; `+`, spaces and dashes are fine) or a WhatsApp JID (`…@s.whatsapp.net`, `…@c.us`, a group `…@g.us`). Media goes by public `url` or by `base64`.

```php
$messages = $client->messages();

$messages->sendText($profileId, $to, 'Hello!');
$messages->sendText($profileId, $to, 'Yes', quotedMessageId: $whatsappMessageId); // quote a message
$messages->sendImage($profileId, $to, url: 'https://example.com/a.jpg', caption: 'Look');
$messages->sendVideo($profileId, $to, url: 'https://example.com/a.mp4', caption: 'Watch');
$messages->sendAudio($profileId, $to, url: 'https://example.com/a.ogg', ptt: true); // ptt: voice note
$messages->sendDocument($profileId, $to, 'report.pdf', url: 'https://example.com/report.pdf', caption: 'Q3');
$messages->sendLocation($profileId, $to, -6.2088, 106.8456, name: 'Monas', address: 'Jakarta');
$messages->sendContact($profileId, $to, 'Budi', '628111111111', email: 'budi@example.com');
$messages->sendPoll($profileId, $to, 'Lunch?', ['Rice', 'Noodles'], allowMultipleAnswers: false);
$messages->sendReaction($profileId, $result->messageId, '👍'); // MultiWA's message id; '' removes it

// Stored messages, newest first (rows as the API returns them)
$rows = $messages->list($profileId, limit: 50, offset: 0, type: 'text', direction: 'incoming');
```

Every send returns a `MultiWA\Models\MessageResult`:

| Property | Meaning |
|----------|---------|
| `success` | `false` when sending failed; `error` says why |
| `messageId` | MultiWA's id of the stored message, the one `sendReaction()` takes |
| `conversationId` | The conversation the message belongs to |
| `status` | `sent`, `queued` (a worker sends it) or `failed` |
| `waMessageId` | WhatsApp's id of the message once WhatsApp accepted it (`null` while queued); [WebSocket](./08-websocket-api.md) `message:ack` events use this id |
| `error` | Why sending failed |

### Contacts

```php
$contacts = $client->contacts();

// Creates the contact, or merges tags and metadata into the one with this phone
$contact = $contacts->create($profileId, '628123456789', name: 'Budi', tags: ['vip'], metadata: ['source' => 'web']);
$contact = $contacts->get($contact->id);

$page = $contacts->list($profileId, search: 'bud', tags: ['vip', 'new'], limit: 50, offset: 0);
// ['contacts' => Contact[], 'total' => 1, 'limit' => 50, 'offset' => 0]

$contacts->update($contact->id, name: 'Budi S', tags: ['vip']); // tags and metadata replace the old ones
$contacts->delete($contact->id); // ['success' => true]
```

A `Contact` has `id`, `profileId`, `phone`, `name`, `whatsappName`, `avatarUrl`, `tags`, `metadata`, `isBlocked` and the `lastMessageAt`, `createdAt` and `updatedAt` dates.

### Broadcasts

A broadcast is created as a draft and sends only when it is started or scheduled. The profile's send limits pace it.

```php
$broadcasts = $client->broadcasts();

$broadcast = $broadcasts->create(
    profileId: $profileId,
    name: 'Promo Campaign',
    message: 'Hello! Our promo starts today.',            // a text, or a message array (below)
    recipients: ['type' => 'tags', 'value' => ['vip']],
    settings: ['delayMin' => 5000, 'delayMax' => 15000],   // optional
);

$broadcasts->update($broadcast->id, name: 'Promo Campaign v2');  // drafts only
$broadcasts->schedule($broadcast->id, new DateTimeImmutable('2026-11-01 09:00', new DateTimeZone('Asia/Jakarta')));
$broadcasts->start($broadcast->id);   // ['success' => true, 'message' => 'Broadcast started', 'recipientCount' => 42]
$broadcasts->pause($broadcast->id);   // the Broadcast, status paused
$broadcasts->resume($broadcast->id);  // ['success' => true, 'message' => 'Broadcast resumed']
$broadcasts->cancel($broadcast->id);  // the Broadcast, status failed
$broadcasts->delete($broadcast->id);  // ['success' => true]; not while it is running

$broadcasts->get($broadcast->id);
$broadcasts->list($profileId, status: 'running'); // Broadcast[]
$broadcasts->stats($broadcast->id);
// ['id' => …, 'status' => 'completed', 'stats' => ['total' => 10, 'sent' => 9, 'delivered' => 8,
//  'read' => 5, 'failed' => 1, 'pending' => 0, 'successRate' => 80, 'progress' => 100], 'duration' => 600, …]
```

| Argument | Shape |
|----------|-------|
| `message` | A string is sent as text. For media pass an array: `['type' => 'image', 'url' => 'https://…', 'text' => 'caption', 'mimetype' => 'image/jpeg']`. Types: `text`, `image`, `video`, `audio`, `document` (a document also takes `filename`) |
| `recipients` | `['type' => 'tags', 'value' => [tag, …]]` (contacts with any of the tags), `['type' => 'contacts', 'value' => [contact id or phone, …]]`, or `['type' => 'all']` |
| `settings` | `delayMin` and `delayMax` (ms between messages), `batchSize`, `retryFailed`, `retryAttempts` |

A `Broadcast` has `id`, `profileId`, `name`, `status` (`draft`, `scheduled`, `running`, `paused`, `completed`, `failed`), `message`, `recipients`, `settings`, `stats` (`total`, `pending`, `sent`, `delivered`, `read`, `failed`) and the `scheduledAt`, `startedAt`, `completedAt`, `createdAt` and `updatedAt` dates.

### Profiles

A profile is one WhatsApp number.

```php
$profiles = $client->profiles();

$profile = $profiles->create($workspaceId, 'My WhatsApp', engine: 'whatsapp-web-js'); // engine is optional
$profile = $profiles->get($profile->id);           // $profile->displayName, ->phoneNumber, ->status, …
$all = $profiles->list($workspaceId);              // Profile[] with messageCount; workspaceId is optional
$profiles->update($profile->id, name: 'Sales');    // also engine, webhookUrl, webhookSecret
$profiles->status($profile->id);
// ['id' => …, 'name' => 'Sales', 'status' => 'connected', 'phone' => '628…', 'lastConnectedAt' => …, 'engineConnected' => true]
$profiles->disconnect($profile->id);               // ['status' => 'disconnected']
$profiles->delete($profile->id);                   // ['success' => true]; also deletes its messages and contacts
```

#### Linking a number (QR code)

```php
$profiles->connect($profileId); // ['status' => 'connecting', 'message' => 'Scan QR code to connect']
```

The QR code is not part of the REST API. It is pushed as the `qr:update` event of the [WebSocket API](./08-websocket-api.md): a Socket.IO client connects to the `/ws` namespace with the API key, emits `join` with the profile id, and shows each event's `qrCode` (a `data:image/png;base64,…` URL) until it is scanned. The event reaches owners and admins only: a dashboard sign-in of one qualifies, and so does an API key of one with `profiles:write` (or no scope list). It can also be scanned in the admin dashboard. Afterwards `status()` reports `connected`. A profile that is already linked answers `['status' => 'already_connected', …]`.

### Webhooks

```php
use MultiWA\Clients\WebhooksClient;

$webhooks = $client->webhooks();

$webhook = $webhooks->create($profileId, 'https://your-webhook.com/whatsapp', ['message.received', 'message.sent']);
$secret = $webhook->secret; // generated by the server; keep it to verify deliveries

$webhooks->get($webhook->id);
$webhooks->list($profileId);                                      // Webhook[]
$webhooks->update($webhook->id, events: ['message.received'], enabled: false);
$webhooks->test($webhook->id);   // sends a signed `test` event: ['success' => true, 'message' => …]
$webhooks->delete($webhook->id); // ['success' => true]

// In your webhook endpoint: verify the signature over the RAW body
$ok = WebhooksClient::verifySignature(
    file_get_contents('php://input'),
    $_SERVER['HTTP_X_MULTIWA_SIGNATURE'] ?? null,
    $secret,
);
```

`create()` and `update()` also take `headers`, extra headers sent with every delivery (`['X-Tenant' => 'acme']`). See [Webhook Events](./09-webhook-events.md) for the events and payloads.

### Calls

> `$client->calls()` is in SDK 1.4.0 and later.

Incoming WhatsApp calls: the follow-up queue, the readiness of answering them in the dashboard, the recordings and the announcement ([Calls answered in the dashboard](./23-calls.md)).

```php
$calls = $client->calls();

$page = $calls->list($profileId, outcome: 'answered', limit: 50); // CallPage: ->calls (Call[]), ->nextCursor
foreach ($page->calls as $call) {
    echo $call->fromJid, ' ', $call->answeredBy['name'] ?? '', ' ', $call->talkSeconds, "\n";
}
if ($page->nextCursor !== null) {
    $page = $calls->list($profileId, outcome: 'answered', cursor: $page->nextCursor);
}

$calls->openCount();                                      // the number of open follow-ups in the organization
$call = $calls->get($callId);                             // $call->recording: null, or a CallRecording
$calls->update($callId, followUp: 'done');                // or assignedUserId: '…'
$calls->unassign($callId);                                // removes the assignee
$calls->reject($callId);                                  // a call that still rings
$calls->reply($callId, 'We will call you back');          // ['call' => Call, 'message' => MessageResult]; no text: the profile's default reply
$calls->sendCallLink($callId, 'voice', 'Tap to call us'); // also 'link' => 'https://call.whatsapp.com/…'

// Owners and admins
$status = $calls->mediaStatus();                          // ['server' => […], 'profiles' => [['profileId' => …, 'ready' => true, 'reasons' => []], …]]
$file = fopen('notice.mp3', 'rb');                        // recording needs the announcement first
$calls->uploadAnnouncement($profileId, $file);            // also bytes; a stream goes under its file's name
fclose($file);                                            // the SDK leaves your stream open
$calls->updateSettings($profileId, answerInDashboard: true, recording: true, retentionDays: 30); // CallsSettings
$notice = $calls->getAnnouncement($profileId);            // AudioFile: ->content, ->contentType

$audio = $calls->getRecording($callId, download: true);   // audio/webm
file_put_contents("call-{$callId}.webm", $audio->content);
$calls->deleteRecording($callId);                         // ['callId' => …, 'recordingId' => …, 'deletedAt' => …]

$calls->updateSettings($profileId, recording: false);
$calls->deleteAnnouncement($profileId);                   // refused with 409 while recording is on
```

Everything above `// Owners and admins` is for owners, admins and members (a viewer's key gets 403), except `list()`, `openCount()` and `get()`, which a viewer's key may call too; the rest is for owners and admins. An API key acts with its user's role, and a key with a scope list also needs `messages:write` for `reply()` and `sendCallLink()`, `recordings:read` to fetch a recording, `recordings:delete` to delete one, and `profiles:write` for the settings and the announcement, with `recordings:delete` too for `retentionDays` ([API keys](./23-calls.md#api-keys)). With Guzzle's cURL handler, the default, the client's `timeout` covers a whole download: a long recording may need a larger one.

A setting that cannot be turned on throws an `ApiException` with status 409, whose body says why:

```php
use MultiWA\Exceptions\ApiException;

try {
    $calls->updateSettings($profileId, recording: true);
} catch (ApiException $e) {
    if ($e->getStatusCode() === 409) {
        print_r($e->getResponseBody()['reasons']); // e.g. ['no_announcement']
    }
}
```

The SDK has no realtime events for calls: answering is for people signed in to the dashboard, and an API key never gets the agents' events. Follow calls with the `call.*` [webhooks](./09-webhook-events.md#call-events), or the [WebSocket](./08-websocket-api.md#83-events) `call:update` event.

### Other routes

`request()` calls any route of the [REST API](./07-api-specification.md) with the same authentication and error handling, and returns the decoded JSON:

```php
$result = $client->request('POST', 'messages/otp', [
    'json' => ['profileId' => $profileId, 'to' => $to, 'text' => 'Your code is 563842', 'code' => '563842'],
]);
```

---

## Exception Handling

Everything the SDK throws extends `MultiWA\Exceptions\MultiWAException`:

| Exception | Thrown for | Adds |
|-----------|------------|------|
| `MultiWAException` | No response (connection failed, timeout) or a success that is not JSON | |
| `ApiException` | Any 4xx or 5xx, e.g. 409 `PROFILE_DISCONNECTED` (sent while the profile is offline) | `getStatusCode()`, `getErrorCode()`, `getResponseBody()` |
| `ValidationException` | 400, 422 | `getErrors()`: the validation messages |
| `AuthenticationException` | 401 (bad or missing API key), 403 (not allowed, or not in your organization) | |
| `NotFoundException` | 404 | |
| `RateLimitException` | 429 | `getRetryAt()` |

The four specific ones extend `ApiException`. `getErrorCode()` returns the API's machine-readable code when it sends one (`PROFILE_DISCONNECTED`, `DAILY_LIMIT_REACHED`, `OTP_DELIVERY_FAILED`, …), else `null`. A resource of another organization, or one that does not exist, usually answers 403: the API does not reveal which.

A 429 is the send gate protecting the number. Its code says which limit:

| `getErrorCode()` | Meaning | `getRetryAt()` |
|------------------|---------|----------------|
| `DAILY_LIMIT_REACHED` | The profile's daily cap | When the counter resets |
| `COLD_DAILY_LIMIT_REACHED` | The cap for messages to chats that have not written to the number within the service window (24 hours by default) | When the counter resets |
| `COLD_CIRCUIT_OPEN` | Those messages are paused after repeated failed deliveries | When they resume |
| `REPEAT_SUPPRESSED` | The same text to the same chat moments ago | When it may be sent again |
| `null` | Too many API requests per minute | `null` |

```php
use MultiWA\Exceptions\ApiException;
use MultiWA\Exceptions\MultiWAException;
use MultiWA\Exceptions\RateLimitException;
use MultiWA\Exceptions\ValidationException;

try {
    $result = $client->messages()->sendText($profileId, $to, 'Hello!');
    if (!$result->success) {
        echo "WhatsApp refused it: {$result->error}";
    }
} catch (RateLimitException $e) {
    echo "{$e->getErrorCode()}, retry after {$e->getRetryAt()?->format(DATE_ATOM)}";
} catch (ValidationException $e) {
    echo implode("\n", $e->getErrors());
} catch (ApiException $e) {
    echo "HTTP {$e->getStatusCode()} {$e->getErrorCode()}: {$e->getMessage()}";
} catch (MultiWAException $e) {
    echo "MultiWA unreachable: {$e->getMessage()}";
}
```

---

## Testing

Pass a Guzzle handler as the last constructor argument to answer requests without a server:

```php
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\Psr7\Response;

$client = new MultiWA('https://wa.example.com/api/v1', 'test-key', handler: new MockHandler([
    new Response(201, [], '{"success":true,"messageId":"m1","conversationId":"c1","status":"sent"}'),
]));
```

---

## Laravel Integration

```php
// config/services.php
'multiwa' => [
    'base_url' => env('MULTIWA_BASE_URL', 'http://localhost:3333/api/v1'),
    'api_key' => env('MULTIWA_API_KEY'),
],

// AppServiceProvider
use MultiWA\MultiWA;

$this->app->singleton(MultiWA::class, function ($app) {
    return new MultiWA(
        baseUrl: config('services.multiwa.base_url'),
        apiKey: config('services.multiwa.api_key'),
    );
});

// Controller
public function send(MultiWA $client)
{
    return $client->messages()->sendText(...);
}
```

---

[← Python SDK](./13-sdk-python.md) · [Documentation Index](./README.md) · [n8n Integration →](./15-n8n-integration.md)

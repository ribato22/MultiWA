# 14 - PHP SDK

Official PHP SDK for MultiWA: the Composer package `multiwa/multiwa-php`, source in [`packages/sdk-php`](https://github.com/ribato22/MultiWA/tree/main/packages/sdk-php).

---

## Installation

```bash
composer require multiwa/multiwa-php
```

The first Packagist release is 1.3.0 (see [Releasing & Distribution](./21-releasing-and-distribution.md)). Until it is live, install from a clone of this repository with a Composer `path` repository:

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

The QR code is not part of the REST API. It is pushed as the `qr:update` event of the [WebSocket API](./08-websocket-api.md): a Socket.IO client connects to the `/ws` namespace with the API key, emits `join` with the profile id, and shows each event's `qrCode` (a `data:image/png;base64,…` URL) until it is scanned. It can also be scanned in the admin dashboard. Afterwards `status()` reports `connected`. A profile that is already linked answers `['status' => 'already_connected', …]`.

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

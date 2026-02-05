# MultiWA PHP SDK

Official PHP SDK for [MultiWA](https://github.com/ribato22/multiwa) - WhatsApp Business API Gateway.

## Requirements

- PHP 8.1 or higher
- Guzzle HTTP Client 7.5+

## Installation

```bash
composer require multiwa/multiwa-php
```

## Quick Start

```php
<?php

use MultiWA\MultiWA;

// Initialize the client
$client = new MultiWA(
    baseUrl: 'https://your-multiwa-instance.com/api',
    apiKey: 'your-api-key'
);

// Send a text message
$result = $client->messages()->sendText(
    profileId: 'your-profile-id',
    to: '6281234567890',
    text: 'Hello from MultiWA PHP SDK!'
);

print_r($result);
```

## Features

### Messages

```php
// Send text
$client->messages()->sendText($profileId, $to, 'Hello!');

// Send image
$client->messages()->sendImage($profileId, $to, url: 'https://...', caption: 'Check this!');

// Send video
$client->messages()->sendVideo($profileId, $to, url: 'https://...', caption: 'Watch!');

// Send document
$client->messages()->sendDocument($profileId, $to, filename: 'report.pdf', url: 'https://...');

// Send location
$client->messages()->sendLocation($profileId, $to, -6.2088, 106.8456, name: 'Jakarta');

// Send contact
$client->messages()->sendContact($profileId, $to, 'John Doe', '+6281234567890');

// Send poll
$client->messages()->sendPoll(
    profileId: $profileId,
    to: $to,
    question: "What's your favorite color?",
    options: ['Red', 'Green', 'Blue']
);
```

### Contacts

```php
// Create contact
$client->contacts()->create(
    profileId: $profileId,
    phone: '6281234567890',
    name: 'John Doe',
    tags: ['customer', 'vip']
);

// List contacts
$contacts = $client->contacts()->list($profileId);
```

### Broadcasts

```php
// Create broadcast
$client->broadcasts()->create(
    profileId: $profileId,
    name: 'Promo Campaign',
    recipients: ['6281234567890', '6281234567891'],
    templateId: 'template-uuid'
);

// Start broadcast
$client->broadcasts()->start($broadcastId);
```

### Profiles

```php
// Create profile
$profile = $client->profiles()->create($workspaceId, 'My WhatsApp');

// Connect and get QR
$qr = $client->profiles()->getQr($profileId);

// Check status
$status = $client->profiles()->status($profileId);
```

### Webhooks

```php
// Create webhook
$client->webhooks()->create(
    profileId: $profileId,
    url: 'https://your-webhook.com/whatsapp',
    events: ['message.received', 'message.sent']
);
```

## Error Handling

```php
use MultiWA\Exceptions\MultiWAException;
use MultiWA\Exceptions\ApiException;

try {
    $result = $client->messages()->sendText($profileId, $to, 'Hello!');
} catch (ApiException $e) {
    echo "API Error: " . $e->getMessage();
    echo "Status: " . $e->getStatusCode();
} catch (MultiWAException $e) {
    echo "Error: " . $e->getMessage();
}
```

## License

MIT - See [LICENSE](LICENSE) for details.

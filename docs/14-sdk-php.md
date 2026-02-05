# 14 - PHP SDK

Official PHP SDK for MultiWA.

---

## Installation

```bash
composer require multiwa/multiwa
```

---

## Requirements

- PHP 8.0+
- Guzzle HTTP 7.0+

---

## Quick Start

```php
<?php

require_once 'vendor/autoload.php';

use MultiWA\MultiWA;

$client = new MultiWA(
    baseUrl: 'http://localhost:3001/api',
    apiKey: 'YOUR_API_KEY'
);

// Send a text message
$result = $client->messages()->sendText(
    profileId: 'profile-123',
    to: '628123456789',
    text: 'Hello from PHP!'
);

echo "Message ID: " . $result->messageId;
```

---

## API Reference

### Messages

```php
// Text
$client->messages()->sendText($profileId, $to, $text);

// Image
$client->messages()->sendImage($profileId, $to, $url, $caption);

// Video
$client->messages()->sendVideo($profileId, $to, $url, $caption);

// Document
$client->messages()->sendDocument($profileId, $to, $url, $filename);

// Location
$client->messages()->sendLocation($profileId, $to, $latitude, $longitude, $description);

// Contact
$client->messages()->sendContact($profileId, $to, $name, $phone);

// Poll
$client->messages()->sendPoll($profileId, $to, $question, $options, $allowMultiple);
```

### Contacts

```php
// List
$contacts = $client->contacts()->getAll($profileId);

// Create
$contact = $client->contacts()->create($profileId, $phone, $name, $tags);

// Update
$client->contacts()->update($contactId, ['name' => 'New Name']);

// Delete
$client->contacts()->delete($contactId);
```

### Broadcasts

```php
// Create campaign
$campaign = $client->broadcasts()->create([
    'profileId' => 'profile-123',
    'name' => 'Promo Campaign',
    'message' => 'Hello {name}!',
    'recipients' => ['628123456789', '628987654321']
]);

// Start broadcast
$client->broadcasts()->start($campaign->id);

// Get stats
$stats = $client->broadcasts()->getStats($campaign->id);
```

### Profiles

```php
// List
$profiles = $client->profiles()->getAll();

// Create
$profile = $client->profiles()->create('My WhatsApp');

// Get QR
$qr = $client->profiles()->getQr($profile->id);

// Connect
$client->profiles()->connect($profile->id);
```

---

## Exception Handling

```php
use MultiWA\Exceptions\MultiWAException;
use MultiWA\Exceptions\ValidationException;
use MultiWA\Exceptions\AuthenticationException;

try {
    $result = $client->messages()->sendText(...);
} catch (ValidationException $e) {
    echo "Validation error: " . $e->getMessage();
} catch (AuthenticationException $e) {
    echo "Auth error: " . $e->getMessage();
} catch (MultiWAException $e) {
    echo "API error: " . $e->getMessage();
}
```

---

## Laravel Integration

```php
// config/services.php
'multiwa' => [
    'base_url' => env('MULTIWA_BASE_URL', 'http://localhost:3001/api'),
    'api_key' => env('MULTIWA_API_KEY'),
],

// AppServiceProvider
use MultiWA\MultiWA;

$this->app->singleton(MultiWA::class, function ($app) {
    return new MultiWA(
        config('services.multiwa.base_url'),
        config('services.multiwa.api_key')
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

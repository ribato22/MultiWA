<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use MultiWA\Models\Webhook;
use MultiWA\MultiWA;

/**
 * Webhooks API: deliver a profile's events to your URL.
 */
class WebhooksClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * Verify a MultiWA webhook HMAC-SHA256 signature.
     *
     * MultiWA signs every webhook with HMAC-SHA256 over the RAW request body and
     * sends it in the `X-MultiWA-Signature` header as `sha256=<hex>`. Pass the raw
     * body (e.g. `file_get_contents('php://input')`) — not a re-encoded array.
     *
     * @return bool True when the signature is valid.
     */
    public static function verifySignature(string $payload, ?string $signature, string $secret): bool
    {
        if ($signature === null || $signature === '' || $secret === '') {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);
        return hash_equals($expected, $signature);
    }

    /**
     * Subscribes a URL to events of a profile. The server generates the signing
     * secret: keep Webhook::$secret to verify deliveries.
     *
     * @param string[]              $events  e.g. ['message.received', 'message.sent']
     * @param array<string, string> $headers Extra headers sent with every delivery
     */
    public function create(
        string $profileId,
        string $url,
        array $events,
        array $headers = [],
    ): Webhook {
        return Webhook::fromArray($this->client->request('POST', 'webhooks', [
            'json' => array_filter([
                'profileId' => $profileId,
                'url' => $url,
                'events' => $events,
                'headers' => $headers ? (object) $headers : null,
            ], static fn ($v) => $v !== null),
        ]));
    }

    public function get(string $webhookId): Webhook
    {
        return Webhook::fromArray($this->client->request('GET', self::path($webhookId)));
    }

    /**
     * @return list<Webhook>
     */
    public function list(string $profileId): array
    {
        $rows = $this->client->request('GET', 'webhooks', [
            'query' => ['profileId' => $profileId],
        ]);

        return array_values(array_map(static fn (array $row) => Webhook::fromArray($row), $rows));
    }

    /**
     * Updates the given fields; `events` and `headers` replace the current ones.
     *
     * @param string[]|null              $events
     * @param array<string, string>|null $headers
     */
    public function update(
        string $webhookId,
        ?string $url = null,
        ?array $events = null,
        ?array $headers = null,
        ?bool $enabled = null,
    ): Webhook {
        return Webhook::fromArray($this->client->request('PUT', self::path($webhookId), [
            'json' => array_filter([
                'url' => $url,
                'events' => $events,
                'headers' => $headers === null ? null : (object) $headers,
                'enabled' => $enabled,
            ], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * @return array{success: bool}
     */
    public function delete(string $webhookId): array
    {
        return $this->client->request('DELETE', self::path($webhookId));
    }

    /**
     * Sends a signed sample event (`test`) to the webhook URL.
     *
     * @return array{success: bool, message: string}
     */
    public function test(string $webhookId): array
    {
        return $this->client->request('POST', self::path($webhookId) . '/test');
    }

    private static function path(string $webhookId): string
    {
        return 'webhooks/' . rawurlencode($webhookId);
    }
}

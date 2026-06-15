<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Client as HttpClient;
use MultiWA\Models\Webhook;

/**
 * Webhooks API Client
 */
class WebhooksClient
{
    public function __construct(
        private readonly HttpClient $http
    ) {}

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

    public function create(
        string $profileId,
        string $url,
        array $events,
        ?string $secret = null,
    ): Webhook {
        $response = $this->http->post('webhooks', [
            'json' => array_filter([
                'profileId' => $profileId,
                'url' => $url,
                'events' => $events,
                'secret' => $secret,
            ], fn($v) => $v !== null),
        ]);

        return Webhook::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function get(string $webhookId): Webhook
    {
        $response = $this->http->get("webhooks/{$webhookId}");
        return Webhook::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function list(
        string $profileId,
        int $limit = 50,
        int $offset = 0,
    ): array {
        $response = $this->http->get("webhooks/profile/{$profileId}", [
            'query' => [
                'limit' => $limit,
                'offset' => $offset,
            ],
        ]);

        $data = json_decode($response->getBody()->getContents(), true);
        return array_map(fn($w) => Webhook::fromArray($w), $data);
    }

    public function update(
        string $webhookId,
        ?string $url = null,
        ?array $events = null,
        ?bool $isActive = null,
        ?string $secret = null,
    ): Webhook {
        $data = array_filter([
            'url' => $url,
            'events' => $events,
            'isActive' => $isActive,
            'secret' => $secret,
        ], fn($v) => $v !== null);

        $response = $this->http->patch("webhooks/{$webhookId}", ['json' => $data]);
        return Webhook::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function delete(string $webhookId): array
    {
        $response = $this->http->delete("webhooks/{$webhookId}");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function test(string $webhookId): array
    {
        $response = $this->http->post("webhooks/{$webhookId}/test");
        return json_decode($response->getBody()->getContents(), true);
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Client as HttpClient;
use MultiWA\Models\Broadcast;

/**
 * Broadcasts API Client
 */
class BroadcastsClient
{
    public function __construct(
        private readonly HttpClient $http
    ) {}

    public function create(
        string $profileId,
        string $name,
        array $recipients,
        ?string $templateId = null,
        ?string $message = null,
        ?string $scheduleAt = null,
    ): Broadcast {
        $response = $this->http->post('broadcasts', [
            'json' => array_filter([
                'profileId' => $profileId,
                'name' => $name,
                'recipients' => $recipients,
                'templateId' => $templateId,
                'message' => $message,
                'scheduleAt' => $scheduleAt,
            ], fn($v) => $v !== null),
        ]);

        return Broadcast::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function get(string $broadcastId): Broadcast
    {
        $response = $this->http->get("broadcasts/{$broadcastId}");
        return Broadcast::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function list(
        string $profileId,
        int $limit = 50,
        int $offset = 0,
        ?string $status = null,
    ): array {
        $response = $this->http->get("broadcasts/profile/{$profileId}", [
            'query' => array_filter([
                'limit' => $limit,
                'offset' => $offset,
                'status' => $status,
            ], fn($v) => $v !== null),
        ]);

        $data = json_decode($response->getBody()->getContents(), true);
        return array_map(fn($b) => Broadcast::fromArray($b), $data);
    }

    public function start(string $broadcastId): Broadcast
    {
        $response = $this->http->post("broadcasts/{$broadcastId}/start");
        return Broadcast::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function pause(string $broadcastId): Broadcast
    {
        $response = $this->http->post("broadcasts/{$broadcastId}/pause");
        return Broadcast::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function cancel(string $broadcastId): Broadcast
    {
        $response = $this->http->post("broadcasts/{$broadcastId}/cancel");
        return Broadcast::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function delete(string $broadcastId): array
    {
        $response = $this->http->delete("broadcasts/{$broadcastId}");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function stats(string $broadcastId): array
    {
        $response = $this->http->get("broadcasts/{$broadcastId}/stats");
        return json_decode($response->getBody()->getContents(), true);
    }
}

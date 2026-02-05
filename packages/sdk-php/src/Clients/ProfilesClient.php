<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Client as HttpClient;
use MultiWA\Models\Profile;

/**
 * Profiles API Client
 */
class ProfilesClient
{
    public function __construct(
        private readonly HttpClient $http
    ) {}

    public function create(
        string $workspaceId,
        string $name,
        string $engine = 'whatsapp-web-js',
    ): Profile {
        $response = $this->http->post('profiles', [
            'json' => [
                'workspaceId' => $workspaceId,
                'name' => $name,
                'engine' => $engine,
            ],
        ]);

        return Profile::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function get(string $profileId): Profile
    {
        $response = $this->http->get("profiles/{$profileId}");
        return Profile::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function list(
        ?string $workspaceId = null,
        int $limit = 50,
        int $offset = 0,
    ): array {
        $response = $this->http->get('profiles', [
            'query' => array_filter([
                'workspaceId' => $workspaceId,
                'limit' => $limit,
                'offset' => $offset,
            ], fn($v) => $v !== null),
        ]);

        $data = json_decode($response->getBody()->getContents(), true);
        return array_map(fn($p) => Profile::fromArray($p), $data);
    }

    public function update(
        string $profileId,
        ?string $name = null,
        ?bool $isActive = null,
    ): Profile {
        $data = array_filter([
            'name' => $name,
            'isActive' => $isActive,
        ], fn($v) => $v !== null);

        $response = $this->http->patch("profiles/{$profileId}", ['json' => $data]);
        return Profile::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function delete(string $profileId): array
    {
        $response = $this->http->delete("profiles/{$profileId}");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function connect(string $profileId): array
    {
        $response = $this->http->post("profiles/{$profileId}/connect");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function disconnect(string $profileId): array
    {
        $response = $this->http->post("profiles/{$profileId}/disconnect");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function getQr(string $profileId): array
    {
        $response = $this->http->get("profiles/{$profileId}/qr");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function status(string $profileId): array
    {
        $response = $this->http->get("profiles/{$profileId}/status");
        return json_decode($response->getBody()->getContents(), true);
    }
}

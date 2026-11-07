<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use MultiWA\Models\Profile;
use MultiWA\MultiWA;

/**
 * Profiles API: the WhatsApp numbers connected to MultiWA.
 *
 * Linking a number: call connect(), then show the QR code that the WebSocket
 * API pushes as the `qr:update` event (namespace /ws, join the profile first)
 * until it is scanned. The REST API has no QR route.
 */
class ProfilesClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * @param string|null $engine whatsapp-web-js (the server default), baileys (experimental) or mock
     */
    public function create(
        string $workspaceId,
        string $name,
        ?string $engine = null,
        ?string $webhookUrl = null,
        ?string $webhookSecret = null,
    ): Profile {
        return Profile::fromArray($this->client->request('POST', 'profiles', [
            'json' => array_filter([
                'workspaceId' => $workspaceId,
                'name' => $name,
                'engine' => $engine,
                'webhookUrl' => $webhookUrl,
                'webhookSecret' => $webhookSecret,
            ], static fn ($v) => $v !== null),
        ]));
    }

    public function get(string $profileId): Profile
    {
        return Profile::fromArray($this->client->request('GET', self::path($profileId)));
    }

    /**
     * Profiles of the API key's organization, newest first.
     *
     * @return list<Profile>
     */
    public function list(?string $workspaceId = null): array
    {
        $rows = $this->client->request('GET', 'profiles', [
            'query' => ['workspaceId' => $workspaceId],
        ]);

        return array_values(array_map(static fn (array $row) => Profile::fromArray($row), $rows));
    }

    /**
     * Updates the given fields. An engine change applies on the next connect.
     */
    public function update(
        string $profileId,
        ?string $name = null,
        ?string $engine = null,
        ?string $webhookUrl = null,
        ?string $webhookSecret = null,
    ): Profile {
        return Profile::fromArray($this->client->request('PUT', self::path($profileId), [
            'json' => array_filter([
                'name' => $name,
                'engine' => $engine,
                'webhookUrl' => $webhookUrl,
                'webhookSecret' => $webhookSecret,
            ], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * Disconnects the profile, then deletes it with its messages, contacts and
     * conversations.
     *
     * @return array{success: bool}
     */
    public function delete(string $profileId): array
    {
        return $this->client->request('DELETE', self::path($profileId));
    }

    /**
     * Starts the WhatsApp engine of the profile. Status `connecting`: the QR
     * code follows as the WebSocket `qr:update` event. `already_connected`:
     * nothing to scan.
     *
     * @return array{status: string, message?: string, phone?: string|null}
     */
    public function connect(string $profileId): array
    {
        return $this->client->request('POST', self::path($profileId) . '/connect');
    }

    /**
     * @return array{status: string}
     */
    public function disconnect(string $profileId): array
    {
        return $this->client->request('POST', self::path($profileId) . '/disconnect');
    }

    /**
     * @return array{id: string, name: string|null, status: string, phone: string|null, lastConnectedAt: string|null, engineConnected: bool}
     */
    public function status(string $profileId): array
    {
        return $this->client->request('GET', self::path($profileId) . '/status');
    }

    private static function path(string $profileId): string
    {
        return 'profiles/' . rawurlencode($profileId);
    }
}

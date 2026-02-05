<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Client as HttpClient;
use MultiWA\Models\Contact;

/**
 * Contacts API Client
 */
class ContactsClient
{
    public function __construct(
        private readonly HttpClient $http
    ) {}

    public function create(
        string $profileId,
        string $phone,
        ?string $name = null,
        ?string $email = null,
        array $tags = [],
        array $metadata = [],
    ): Contact {
        $response = $this->http->post('contacts', [
            'json' => [
                'profileId' => $profileId,
                'phone' => $phone,
                'name' => $name,
                'email' => $email,
                'tags' => $tags,
                'metadata' => $metadata,
            ],
        ]);

        return Contact::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function get(string $contactId): Contact
    {
        $response = $this->http->get("contacts/{$contactId}");
        return Contact::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function update(
        string $contactId,
        ?string $name = null,
        ?string $email = null,
        ?array $tags = null,
        ?array $metadata = null,
    ): Contact {
        $data = array_filter([
            'name' => $name,
            'email' => $email,
            'tags' => $tags,
            'metadata' => $metadata,
        ], fn($v) => $v !== null);

        $response = $this->http->patch("contacts/{$contactId}", ['json' => $data]);
        return Contact::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    public function delete(string $contactId): array
    {
        $response = $this->http->delete("contacts/{$contactId}");
        return json_decode($response->getBody()->getContents(), true);
    }

    public function list(
        string $profileId,
        int $limit = 50,
        int $offset = 0,
        ?string $search = null,
    ): array {
        $response = $this->http->get("contacts/profile/{$profileId}", [
            'query' => array_filter([
                'limit' => $limit,
                'offset' => $offset,
                'search' => $search,
            ], fn($v) => $v !== null),
        ]);

        $data = json_decode($response->getBody()->getContents(), true);
        return array_map(fn($c) => Contact::fromArray($c), $data);
    }
}

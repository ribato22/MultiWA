<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Psr7\Query;
use MultiWA\Models\Contact;
use MultiWA\MultiWA;

/**
 * Contacts API.
 */
class ContactsClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * Creates a contact. When the profile already has one with this phone, that
     * contact is updated instead: the tags and metadata are merged in.
     *
     * @param string[]             $tags
     * @param array<string, mixed> $metadata
     */
    public function create(
        string $profileId,
        string $phone,
        ?string $name = null,
        array $tags = [],
        array $metadata = [],
    ): Contact {
        return Contact::fromArray($this->client->request('POST', 'contacts', [
            'json' => array_filter([
                'profileId' => $profileId,
                'phone' => $phone,
                'name' => $name,
                'tags' => $tags ?: null,
                // The API wants a JSON object; an empty PHP array would encode as [].
                'metadata' => $metadata ? (object) $metadata : null,
            ], static fn ($v) => $v !== null),
        ]));
    }

    public function get(string $contactId): Contact
    {
        return Contact::fromArray($this->client->request('GET', self::path($contactId)));
    }

    /**
     * Contacts of a profile, most recently updated first.
     *
     * @param string|null $search Matches name, WhatsApp name or phone
     * @param string[]    $tags   Contacts with at least one of these tags
     *
     * @return array{contacts: list<Contact>, total: int, limit: int, offset: int}
     */
    public function list(
        string $profileId,
        ?string $search = null,
        array $tags = [],
        int $limit = 50,
        int $offset = 0,
    ): array {
        $data = $this->client->request('GET', 'contacts', [
            // Query::build repeats a list key (tags=a&tags=b), which is what the API
            // reads; Guzzle's default would send tags[0]=a, which it ignores.
            'query' => Query::build(array_filter([
                'profileId' => $profileId,
                'search' => $search,
                'tags' => $tags ?: null,
                'limit' => $limit,
                'offset' => $offset,
            ], static fn ($v) => $v !== null)),
        ]);

        return [
            'contacts' => array_values(array_map(static fn (array $c) => Contact::fromArray($c), $data['contacts'])),
            'total' => $data['total'],
            'limit' => $data['limit'],
            'offset' => $data['offset'],
        ];
    }

    /**
     * Updates the given fields; `tags` and `metadata` replace the current ones.
     *
     * @param string[]|null             $tags
     * @param array<string, mixed>|null $metadata
     */
    public function update(
        string $contactId,
        ?string $name = null,
        ?string $phone = null,
        ?array $tags = null,
        ?array $metadata = null,
    ): Contact {
        return Contact::fromArray($this->client->request('PUT', self::path($contactId), [
            'json' => array_filter([
                'name' => $name,
                'phone' => $phone,
                'tags' => $tags,
                'metadata' => $metadata === null ? null : (object) $metadata,
            ], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * @return array{success: bool}
     */
    public function delete(string $contactId): array
    {
        return $this->client->request('DELETE', self::path($contactId));
    }

    private static function path(string $contactId): string
    {
        return 'contacts/' . rawurlencode($contactId);
    }
}

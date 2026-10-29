<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Contact
{
    /**
     * @param string[]             $tags
     * @param array<string, mixed> $metadata
     */
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $phone,
        public readonly ?string $name = null,
        /** The name the contact set in WhatsApp. */
        public readonly ?string $whatsappName = null,
        public readonly ?string $avatarUrl = null,
        public readonly array $tags = [],
        public readonly array $metadata = [],
        public readonly bool $isBlocked = false,
        public readonly ?DateTimeImmutable $lastMessageAt = null,
        public readonly ?DateTimeImmutable $createdAt = null,
        public readonly ?DateTimeImmutable $updatedAt = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            phone: $data['phone'],
            name: $data['name'] ?? null,
            whatsappName: $data['whatsappName'] ?? null,
            avatarUrl: $data['avatarUrl'] ?? null,
            tags: $data['tags'] ?? [],
            metadata: $data['metadata'] ?? [],
            isBlocked: $data['isBlocked'] ?? false,
            lastMessageAt: isset($data['lastMessageAt']) ? new DateTimeImmutable($data['lastMessageAt']) : null,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
            updatedAt: isset($data['updatedAt']) ? new DateTimeImmutable($data['updatedAt']) : null,
        );
    }
}

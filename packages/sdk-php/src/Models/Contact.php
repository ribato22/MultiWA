<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Contact
{
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $phone,
        public readonly ?string $name = null,
        public readonly ?string $email = null,
        public readonly ?string $avatar = null,
        public readonly array $tags = [],
        public readonly array $metadata = [],
        public readonly ?DateTimeImmutable $createdAt = null,
        public readonly ?DateTimeImmutable $updatedAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            phone: $data['phone'],
            name: $data['name'] ?? null,
            email: $data['email'] ?? null,
            avatar: $data['avatar'] ?? null,
            tags: $data['tags'] ?? [],
            metadata: $data['metadata'] ?? [],
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
            updatedAt: isset($data['updatedAt']) ? new DateTimeImmutable($data['updatedAt']) : null,
        );
    }
}

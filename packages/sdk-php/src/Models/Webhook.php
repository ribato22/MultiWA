<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Webhook
{
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $url,
        public readonly array $events,
        public readonly bool $isActive = true,
        public readonly ?string $secret = null,
        public readonly ?DateTimeImmutable $createdAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            url: $data['url'],
            events: $data['events'] ?? [],
            isActive: $data['isActive'] ?? true,
            secret: $data['secret'] ?? null,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
        );
    }
}

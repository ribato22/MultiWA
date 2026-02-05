<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Broadcast
{
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $name,
        public readonly string $status,
        public readonly int $totalRecipients,
        public readonly int $sentCount = 0,
        public readonly int $deliveredCount = 0,
        public readonly int $failedCount = 0,
        public readonly ?DateTimeImmutable $createdAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            name: $data['name'],
            status: $data['status'],
            totalRecipients: $data['totalRecipients'] ?? 0,
            sentCount: $data['sentCount'] ?? 0,
            deliveredCount: $data['deliveredCount'] ?? 0,
            failedCount: $data['failedCount'] ?? 0,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
        );
    }
}

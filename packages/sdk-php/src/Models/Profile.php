<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Profile
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly ?string $phoneNumber = null,
        public readonly ?string $pushName = null,
        public readonly string $status = 'disconnected',
        public readonly string $engine = 'whatsapp-web-js',
        public readonly bool $isActive = true,
        public readonly ?DateTimeImmutable $createdAt = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            name: $data['name'],
            phoneNumber: $data['phoneNumber'] ?? null,
            pushName: $data['pushName'] ?? null,
            status: $data['status'] ?? 'disconnected',
            engine: $data['engine'] ?? 'whatsapp-web-js',
            isActive: $data['isActive'] ?? true,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
        );
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

class Broadcast
{
    /**
     * @param array<string, mixed> $message    e.g. ['type' => 'text', 'text' => 'Hello']
     * @param array<string, mixed> $recipients e.g. ['type' => 'tags', 'value' => ['vip']]
     * @param array<string, mixed> $settings   delayMin, delayMax, batchSize, retryFailed, retryAttempts
     * @param array<string, int>   $stats      total, pending, sent, delivered, read, failed
     */
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $name,
        /** draft, scheduled, running, paused, completed or failed. */
        public readonly string $status,
        public readonly array $message = [],
        public readonly array $recipients = [],
        public readonly array $settings = [],
        public readonly array $stats = [],
        public readonly ?DateTimeImmutable $scheduledAt = null,
        public readonly ?DateTimeImmutable $startedAt = null,
        public readonly ?DateTimeImmutable $completedAt = null,
        public readonly ?DateTimeImmutable $createdAt = null,
        public readonly ?DateTimeImmutable $updatedAt = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $message = $data['message'] ?? [];

        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            name: $data['name'],
            status: $data['status'],
            // The API also accepts a bare string message; it sends it as text.
            message: is_string($message) ? ['type' => 'text', 'text' => $message] : $message,
            recipients: $data['recipients'] ?? [],
            settings: $data['settings'] ?? [],
            stats: $data['stats'] ?? [],
            scheduledAt: isset($data['scheduledAt']) ? new DateTimeImmutable($data['scheduledAt']) : null,
            startedAt: isset($data['startedAt']) ? new DateTimeImmutable($data['startedAt']) : null,
            completedAt: isset($data['completedAt']) ? new DateTimeImmutable($data['completedAt']) : null,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
            updatedAt: isset($data['updatedAt']) ? new DateTimeImmutable($data['updatedAt']) : null,
        );
    }
}

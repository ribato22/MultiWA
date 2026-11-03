<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

/**
 * A call's recording: its facts. The audio is CallsClient::getRecording().
 */
class CallRecording
{
    public function __construct(
        public readonly string $id,
        /** Seconds. */
        public readonly int $durationSec = 0,
        public readonly int $bytes = 0,
        /** It may end before its call did: a restart, a recorder that did not stop cleanly, or a write that failed. */
        public readonly bool $partial = false,
        public readonly bool $announcementPlayed = false,
        public readonly ?DateTimeImmutable $createdAt = null,
        /** Set once its file is deleted: the row stays as evidence. */
        public readonly ?DateTimeImmutable $deletedAt = null,
        /** admin or retention. */
        public readonly ?string $deleteReason = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'],
            durationSec: $data['durationSec'] ?? 0,
            bytes: $data['bytes'] ?? 0,
            partial: $data['partial'] ?? false,
            announcementPlayed: $data['announcementPlayed'] ?? false,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
            deletedAt: isset($data['deletedAt']) ? new DateTimeImmutable($data['deletedAt']) : null,
            deleteReason: $data['deleteReason'] ?? null,
        );
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Models;

/**
 * A profile's call settings.
 */
class CallsSettings
{
    /**
     * @param array{mimeType: string, durationSec: float|int}|null $announcement The announcement callers hear first,
     *                                                                           its type and length read from the file
     */
    public function __construct(
        public readonly string $profileId,
        public readonly bool $answerInDashboard = false,
        public readonly bool $recording = false,
        /** 1 to 3650. */
        public readonly int $retentionDays = 90,
        public readonly ?array $announcement = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            profileId: $data['profileId'],
            answerInDashboard: $data['answerInDashboard'] ?? false,
            recording: $data['recording'] ?? false,
            retentionDays: $data['retentionDays'] ?? 90,
            announcement: $data['announcement'] ?? null,
        );
    }
}

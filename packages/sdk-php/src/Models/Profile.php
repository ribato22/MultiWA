<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

/**
 * A WhatsApp number (device) connected to MultiWA.
 */
class Profile
{
    public function __construct(
        public readonly string $id,
        public readonly ?string $displayName = null,
        public readonly ?string $workspaceId = null,
        public readonly ?string $phoneNumber = null,
        /** The name the number shows in WhatsApp. */
        public readonly ?string $pushName = null,
        public readonly ?string $profilePicUrl = null,
        /** disconnected, connecting, connected, ... */
        public readonly string $status = 'disconnected',
        public readonly string $engine = 'whatsapp-web-js',
        public readonly ?DateTimeImmutable $lastConnectedAt = null,
        /** Only set by ProfilesClient::list(). */
        public readonly ?int $messageCount = null,
        /** Only set by ProfilesClient::update() when the engine changed. */
        public readonly ?string $warning = null,
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
            displayName: $data['displayName'] ?? null,
            workspaceId: $data['workspaceId'] ?? null,
            phoneNumber: $data['phoneNumber'] ?? null,
            pushName: $data['pushName'] ?? null,
            profilePicUrl: $data['profilePicUrl'] ?? null,
            status: $data['status'] ?? 'disconnected',
            engine: $data['engine'] ?? 'whatsapp-web-js',
            lastConnectedAt: isset($data['lastConnectedAt']) ? new DateTimeImmutable($data['lastConnectedAt']) : null,
            messageCount: $data['messageCount'] ?? null,
            warning: $data['warning'] ?? null,
            createdAt: isset($data['createdAt']) ? new DateTimeImmutable($data['createdAt']) : null,
            updatedAt: isset($data['updatedAt']) ? new DateTimeImmutable($data['updatedAt']) : null,
        );
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Models;

/**
 * Message result model
 */
class MessageResult
{
    public function __construct(
        public readonly bool $success,
        public readonly ?string $messageId = null,
        public readonly ?string $conversationId = null,
        public readonly ?string $status = null,
        public readonly ?string $error = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            success: $data['success'] ?? false,
            messageId: $data['messageId'] ?? null,
            conversationId: $data['conversationId'] ?? null,
            status: $data['status'] ?? null,
            error: $data['error'] ?? null,
        );
    }
}

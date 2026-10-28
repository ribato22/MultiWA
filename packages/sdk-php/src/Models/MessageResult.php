<?php

declare(strict_types=1);

namespace MultiWA\Models;

/**
 * Result of a send: the message was sent, queued, or (success false) failed.
 */
class MessageResult
{
    public function __construct(
        public readonly bool $success,
        /** MultiWA's id of the stored message, the one MessagesClient::sendReaction() takes. */
        public readonly ?string $messageId = null,
        public readonly ?string $conversationId = null,
        /** sent, queued or failed. */
        public readonly ?string $status = null,
        /** WhatsApp's id of the message once WhatsApp accepted it (null while queued); message:ack events use it. */
        public readonly ?string $waMessageId = null,
        public readonly ?string $error = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            success: $data['success'] ?? false,
            messageId: $data['messageId'] ?? null,
            conversationId: $data['conversationId'] ?? null,
            status: $data['status'] ?? null,
            waMessageId: $data['waMessageId'] ?? null,
            error: $data['error'] ?? null,
        );
    }
}

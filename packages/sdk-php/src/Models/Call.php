<?php

declare(strict_types=1);

namespace MultiWA\Models;

use DateTimeImmutable;

/**
 * An incoming WhatsApp call: its outcome, its follow-up and, for one answered in the dashboard, who answered it and
 * how it ended.
 */
class Call
{
    /**
     * @param array<string, mixed>                       $metadata
     * @param array{id: string, name: string}|null       $assignedUser
     * @param array{id: string, name: string}|null       $answeredBy
     * @param array{id: string, name: string|null}|null  $conversation
     */
    public function __construct(
        public readonly string $id,
        public readonly string $profileId,
        public readonly string $waCallId,
        /** The caller, e.g. 628111000111@s.whatsapp.net. */
        public readonly string $fromJid,
        public readonly bool $isVideo = false,
        public readonly bool $isGroup = false,
        public readonly string $direction = 'incoming',
        /** ringing, answered (in the dashboard), missed, rejected, answered_elsewhere or unknown. */
        public readonly string $outcome = 'ringing',
        /** auto, agent or device. */
        public readonly ?string $rejectedBy = null,
        public readonly ?DateTimeImmutable $startedAt = null,
        public readonly ?DateTimeImmutable $endedAt = null,
        /** open, in_progress or done. */
        public readonly string $followUp = 'open',
        public readonly ?string $assignedUserId = null,
        /** The agent who answered it in the dashboard, once the outcome is answered. */
        public readonly ?string $answeredByUserId = null,
        public readonly ?DateTimeImmutable $answeredAt = null,
        /** agent, caller or server. */
        public readonly ?string $endedBy = null,
        /** hangup, caller_hangup, agent_lost, media_failed, time_limit or server_restart. */
        public readonly ?string $endReason = null,
        /** Seconds the agent and the caller talked; null when not known. */
        public readonly ?int $talkSeconds = null,
        public readonly ?DateTimeImmutable $autoReplySentAt = null,
        public readonly ?string $conversationId = null,
        public readonly array $metadata = [],
        public readonly ?array $assignedUser = null,
        public readonly ?array $answeredBy = null,
        public readonly ?array $conversation = null,
        public readonly ?CallRecording $recording = null,
        public readonly ?DateTimeImmutable $createdAt = null,
        public readonly ?DateTimeImmutable $updatedAt = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        $date = static fn (string $key) => isset($data[$key]) ? new DateTimeImmutable($data[$key]) : null;

        return new self(
            id: $data['id'],
            profileId: $data['profileId'],
            waCallId: $data['waCallId'],
            fromJid: $data['fromJid'],
            isVideo: $data['isVideo'] ?? false,
            isGroup: $data['isGroup'] ?? false,
            direction: $data['direction'] ?? 'incoming',
            outcome: $data['outcome'] ?? 'ringing',
            rejectedBy: $data['rejectedBy'] ?? null,
            startedAt: $date('startedAt'),
            endedAt: $date('endedAt'),
            followUp: $data['followUp'] ?? 'open',
            assignedUserId: $data['assignedUserId'] ?? null,
            answeredByUserId: $data['answeredByUserId'] ?? null,
            answeredAt: $date('answeredAt'),
            endedBy: $data['endedBy'] ?? null,
            endReason: $data['endReason'] ?? null,
            talkSeconds: $data['talkSeconds'] ?? null,
            autoReplySentAt: $date('autoReplySentAt'),
            conversationId: $data['conversationId'] ?? null,
            metadata: $data['metadata'] ?? [],
            assignedUser: $data['assignedUser'] ?? null,
            answeredBy: $data['answeredBy'] ?? null,
            conversation: $data['conversation'] ?? null,
            recording: isset($data['recording']) ? CallRecording::fromArray($data['recording']) : null,
            createdAt: $date('createdAt'),
            updatedAt: $date('updatedAt'),
        );
    }
}

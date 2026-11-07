<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use DateTimeInterface;
use MultiWA\Models\Broadcast;
use MultiWA\MultiWA;

/**
 * Broadcast API: send one message to many contacts, paced by the profile's
 * send limits. A broadcast is created as a draft; start() or schedule() sends it.
 *
 * `$message` is a text, or a message array: ['type' => 'text', 'text' => 'Hi'],
 * or a media message such as ['type' => 'image', 'url' => 'https://...',
 * 'text' => 'caption', 'mimetype' => 'image/jpeg'] (types: text, image, video,
 * audio, document; a document also takes 'filename').
 *
 * `$recipients` selects who receives it:
 * ['type' => 'tags', 'value' => ['vip']] (contacts with any of the tags),
 * ['type' => 'contacts', 'value' => [contact ids or phone numbers]], or
 * ['type' => 'all'] (every contact of the profile).
 *
 * `$settings` (optional): delayMin and delayMax (ms between messages),
 * batchSize, retryFailed (bool) and retryAttempts.
 */
class BroadcastsClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * @param string|array<string, mixed> $message
     * @param array<string, mixed>        $recipients
     * @param array<string, mixed>|null   $settings
     */
    public function create(
        string $profileId,
        string $name,
        string|array $message,
        array $recipients,
        ?array $settings = null,
    ): Broadcast {
        return Broadcast::fromArray($this->client->request('POST', 'broadcast', [
            'json' => self::body([
                'profileId' => $profileId,
                'name' => $name,
                'message' => $message,
                'recipients' => $recipients,
                'settings' => $settings,
            ]),
        ]));
    }

    public function get(string $broadcastId): Broadcast
    {
        return Broadcast::fromArray($this->client->request('GET', self::path($broadcastId)));
    }

    /**
     * Broadcasts of a profile, newest first.
     *
     * @param string|null $status draft, scheduled, running, paused, completed or failed
     *
     * @return list<Broadcast>
     */
    public function list(string $profileId, ?string $status = null): array
    {
        $rows = $this->client->request('GET', 'broadcast', [
            'query' => ['profileId' => $profileId, 'status' => $status],
        ]);

        return array_values(array_map(static fn (array $row) => Broadcast::fromArray($row), $rows));
    }

    /**
     * Changes a draft broadcast; the API refuses once it is scheduled or started.
     *
     * @param string|array<string, mixed>|null $message
     * @param array<string, mixed>|null        $recipients
     * @param array<string, mixed>|null        $settings
     */
    public function update(
        string $broadcastId,
        ?string $name = null,
        string|array|null $message = null,
        ?array $recipients = null,
        ?array $settings = null,
    ): Broadcast {
        return Broadcast::fromArray($this->client->request('PUT', self::path($broadcastId), [
            'json' => self::body([
                'name' => $name,
                'message' => $message,
                'recipients' => $recipients,
                'settings' => $settings,
            ]),
        ]));
    }

    /**
     * Schedules a draft broadcast to start at a future time.
     *
     * @param DateTimeInterface|string $scheduledAt A date, or an ISO 8601 string
     */
    public function schedule(string $broadcastId, DateTimeInterface|string $scheduledAt): Broadcast
    {
        return Broadcast::fromArray($this->client->request('POST', self::path($broadcastId) . '/schedule', [
            'json' => [
                'scheduledAt' => $scheduledAt instanceof DateTimeInterface
                    ? $scheduledAt->format(DateTimeInterface::ATOM)
                    : $scheduledAt,
            ],
        ]));
    }

    /**
     * Starts sending now. A paused broadcast continues where it stopped.
     *
     * @return array{success: bool, message: string, recipientCount?: int}
     */
    public function start(string $broadcastId): array
    {
        return $this->client->request('POST', self::path($broadcastId) . '/start');
    }

    public function pause(string $broadcastId): Broadcast
    {
        return Broadcast::fromArray($this->client->request('POST', self::path($broadcastId) . '/pause'));
    }

    /**
     * Continues a paused broadcast with the recipients it has not reached yet.
     *
     * @return array{success: bool, message: string, recipientCount?: int}
     */
    public function resume(string $broadcastId): array
    {
        return $this->client->request('POST', self::path($broadcastId) . '/resume');
    }

    /**
     * Stops the broadcast for good; its status becomes failed.
     */
    public function cancel(string $broadcastId): Broadcast
    {
        return Broadcast::fromArray($this->client->request('POST', self::path($broadcastId) . '/cancel'));
    }

    /**
     * Deletes a broadcast that is not running.
     *
     * @return array{success: bool}
     */
    public function delete(string $broadcastId): array
    {
        return $this->client->request('DELETE', self::path($broadcastId));
    }

    /**
     * Progress of a broadcast. `stats` holds the counters plus successRate and
     * progress (percentages); `duration` is in seconds once completed.
     *
     * @return array{id: string, name: string, status: string, scheduledAt: string|null, startedAt: string|null, completedAt: string|null, stats: array<string, int>, duration: int|null}
     */
    public function stats(string $broadcastId): array
    {
        return $this->client->request('GET', self::path($broadcastId) . '/stats');
    }

    private static function path(string $broadcastId): string
    {
        return 'broadcast/' . rawurlencode($broadcastId);
    }

    /**
     * Drops unset fields and puts the message, recipients and settings in the
     * shape the API validates.
     *
     * @param array<string, mixed> $fields
     *
     * @return array<string, mixed>
     */
    private static function body(array $fields): array
    {
        if (is_string($fields['message'] ?? null)) {
            $fields['message'] = ['type' => 'text', 'text' => $fields['message']];
        }
        if (is_array($fields['recipients'] ?? null)) {
            // The API requires `value`, also for type `all`.
            $fields['recipients'] += ['value' => []];
        }
        if (is_array($fields['settings'] ?? null)) {
            $fields['settings'] = (object) $fields['settings'];
        }

        return array_filter($fields, static fn ($v) => $v !== null);
    }
}

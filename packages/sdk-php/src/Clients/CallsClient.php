<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use DateTimeInterface;
use MultiWA\Models\AudioFile;
use MultiWA\Models\Call;
use MultiWA\Models\CallPage;
use MultiWA\Models\CallsSettings;
use MultiWA\Models\MessageResult;
use MultiWA\MultiWA;

/**
 * Calls API: incoming WhatsApp calls, their follow-up queue, the readiness of answering them in the dashboard, the
 * recordings and the announcement callers hear first. Agents answer calls in the dashboard; follow them with the
 * `call.*` webhooks.
 */
class CallsClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * A page of a profile's calls, newest first (any role; an API key needs no scope). Pass `nextCursor` of a page as
     * `cursor` for the next one.
     *
     * @param string|null                   $outcome  ringing, answered, missed, rejected, answered_elsewhere or unknown
     * @param string|null                   $followUp open, in_progress or done
     * @param string|null                   $from     The caller: a phone number or a JID
     * @param DateTimeInterface|string|null $since    Calls that started at or after it
     * @param int|null                      $limit    1 to 100 (default 50)
     */
    public function list(
        string $profileId,
        ?string $outcome = null,
        ?string $followUp = null,
        ?string $from = null,
        DateTimeInterface|string|null $since = null,
        ?int $limit = null,
        ?string $cursor = null,
    ): CallPage {
        return CallPage::fromArray($this->client->request('GET', 'calls', [
            'query' => array_filter([
                'profileId' => $profileId,
                'outcome' => $outcome,
                'followUp' => $followUp,
                'from' => $from,
                'since' => $since instanceof DateTimeInterface ? $since->format(DateTimeInterface::ATOM) : $since,
                'limit' => $limit,
                'cursor' => $cursor,
            ], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * How many calls of the organization have their follow-up open (any role; an API key needs no scope).
     */
    public function openCount(): int
    {
        return (int) $this->client->request('GET', 'calls/open-count')['count'];
    }

    /**
     * A call, by its ID (any role; an API key needs no scope).
     */
    public function get(string $callId): Call
    {
        return Call::fromArray($this->client->request('GET', self::path($callId)));
    }

    /**
     * Changes the follow-up (open, in_progress, done) or the assignee, an active user of the organization (any role;
     * an API key needs no scope). To remove the assignee, use unassign().
     */
    public function update(string $callId, ?string $followUp = null, ?string $assignedUserId = null): Call
    {
        return Call::fromArray($this->client->request('PATCH', self::path($callId), [
            'json' => (object) array_filter(['followUp' => $followUp, 'assignedUserId' => $assignedUserId], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * Removes the call's assignee (any role; an API key needs no scope).
     */
    public function unassign(string $callId): Call
    {
        return Call::fromArray($this->client->request('PATCH', self::path($callId), ['json' => ['assignedUserId' => null]]));
    }

    /**
     * Rejects a call that is still ringing (any role; an API key needs no scope).
     */
    public function reject(string $callId): Call
    {
        return Call::fromArray($this->client->request('POST', self::path($callId) . '/reject'));
    }

    /**
     * Sends a text to the caller, through the send gate (any role; an API key with a scope list needs
     * `messages:write`); without one, the profile's default call reply.
     *
     * @return array{call: Call, message: MessageResult} The call and the message sent: an `open` follow-up is now
     *                                                   `in_progress`, any other is left as it was
     */
    public function reply(string $callId, ?string $text = null): array
    {
        $result = $this->client->request('POST', self::path($callId) . '/reply', [
            'json' => (object) array_filter(['text' => $text], static fn ($v) => $v !== null),
        ]);

        return ['call' => Call::fromArray($result['call']), 'message' => MessageResult::fromArray($result['message'])];
    }

    /**
     * Creates a WhatsApp call link and sends it to the caller, with an optional text above it (any role; an API key
     * with a scope list needs `messages:write`).
     *
     * @param string $type voice or video
     *
     * @return array{call: Call, message: MessageResult, link: string} The call, the message sent and the link: an
     *                                                                 `open` follow-up is now `in_progress`, any other
     *                                                                 is left as it was
     */
    public function sendCallLink(string $callId, string $type, ?string $text = null): array
    {
        $result = $this->client->request('POST', self::path($callId) . '/call-link', [
            'json' => array_filter(['type' => $type, 'text' => $text], static fn ($v) => $v !== null),
        ]);

        return [
            'call' => Call::fromArray($result['call']),
            'message' => MessageResult::fromArray($result['message']),
            'link' => $result['link'],
        ];
    }

    /**
     * Readiness of answering calls in the dashboard: the server, its recordings storage, and every profile of the
     * organization with its call settings (owner or admin; an API key needs no scope).
     *
     * @return array{server: array{enabled: bool, worker: string, port: int|null, engineHost: string, activeSessions: int, recordings: array{storage: string, configured: bool, problem: string|null, lastCheck: array{at: string, ok: bool, reason?: string}|null}}, profiles: list<array{profileId: string, name: string, answerInDashboard: bool, recording: bool, retentionDays: int, announcement: array{mimeType: string, durationSec: float|int}|null, ready: bool, reasons: list<string>}>}
     */
    public function mediaStatus(): array
    {
        return $this->client->request('GET', 'calls/media/status');
    }

    /**
     * The call's recording, audio/webm (owner or admin; an API key with a scope list needs `recordings:read`).
     * Every read is audited, a download as a download.
     */
    public function getRecording(string $callId, bool $download = false): AudioFile
    {
        return $this->client->requestAudio('GET', self::path($callId) . '/recording', $download ? ['query' => ['download' => '1']] : []);
    }

    /**
     * Deletes the call's recording: the file goes, its row stays as evidence (owner or admin; an API key with a
     * scope list needs `recordings:delete`).
     *
     * @return array{callId: string, recordingId: string, deletedAt: string}
     */
    public function deleteRecording(string $callId): array
    {
        return $this->client->request('DELETE', self::path($callId) . '/recording');
    }

    /**
     * A profile's call settings (owner or admin; an API key with a scope list needs `profiles:write`, and
     * `recordings:delete` too for $retentionDays, 1 to 3650). A setting that cannot be turned on throws an
     * ApiException with status 409: getResponseBody()['reasons'] says why.
     */
    public function updateSettings(
        string $profileId,
        ?bool $answerInDashboard = null,
        ?bool $recording = null,
        ?int $retentionDays = null,
    ): CallsSettings {
        return CallsSettings::fromArray($this->client->request('PUT', self::profilePath($profileId) . '/calls-settings', [
            'json' => (object) array_filter([
                'answerInDashboard' => $answerInDashboard,
                'recording' => $recording,
                'retentionDays' => $retentionDays,
            ], static fn ($v) => $v !== null),
        ]));
    }

    /**
     * Uploads the announcement callers hear before a recorded call (owner or admin; an API key with a scope list
     * needs `profiles:write`): mp3, wav, ogg, webm or m4a, at most 2 MB and 30 seconds. The server reads the type and
     * the length from the file itself.
     *
     * @param string|resource $file The file's bytes, or an open stream such as fopen('notice.mp3', 'r')
     *
     * @return array{profileId: string, announcement: array{mimeType: string, durationSec: float|int}|null}
     */
    public function uploadAnnouncement(string $profileId, mixed $file, string $filename = 'announcement'): array
    {
        return $this->client->request('POST', self::profilePath($profileId) . '/calls-announcement', [
            'multipart' => [['name' => 'file', 'contents' => $file, 'filename' => $filename]],
        ]);
    }

    /**
     * The profile's announcement, to listen to (owner or admin; an API key with a scope list needs
     * `profiles:write`).
     */
    public function getAnnouncement(string $profileId): AudioFile
    {
        return $this->client->requestAudio('GET', self::profilePath($profileId) . '/calls-announcement');
    }

    /**
     * Removes the announcement (owner or admin; an API key with a scope list needs `profiles:write`). While
     * recording is on, the API refuses with 409 (`reasons`: recording_on).
     *
     * @return array{profileId: string, announcement: null}
     */
    public function deleteAnnouncement(string $profileId): array
    {
        return $this->client->request('DELETE', self::profilePath($profileId) . '/calls-announcement');
    }

    private static function path(string $callId): string
    {
        return 'calls/' . rawurlencode($callId);
    }

    private static function profilePath(string $profileId): string
    {
        return 'profiles/' . rawurlencode($profileId);
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use MultiWA\Models\MessageResult;
use MultiWA\MultiWA;

/**
 * Messages API: send text, media, locations, contacts, polls and reactions.
 *
 * `to` is a phone number with country code (6281234567890; +, spaces and
 * dashes are fine) or a WhatsApp JID (…@s.whatsapp.net, …@c.us, a group …@g.us).
 * Media goes by public `url` or by `base64`.
 */
class MessagesClient
{
    public function __construct(
        private readonly MultiWA $client,
    ) {
    }

    /**
     * @param string|null $quotedMessageId WhatsApp id of a message to quote (reply to);
     *                                     an id WhatsApp cannot find is ignored
     */
    public function sendText(
        string $profileId,
        string $to,
        string $text,
        ?string $quotedMessageId = null,
    ): MessageResult {
        return $this->send('text', [
            'profileId' => $profileId,
            'to' => $to,
            'text' => $text,
            'quotedMessageId' => $quotedMessageId,
        ]);
    }

    public function sendImage(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $caption = null,
        ?string $mimetype = null,
    ): MessageResult {
        return $this->send('image', [
            'profileId' => $profileId,
            'to' => $to,
            'url' => $url,
            'base64' => $base64,
            'caption' => $caption,
            'mimetype' => $mimetype,
        ]);
    }

    public function sendVideo(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $caption = null,
        ?string $mimetype = null,
    ): MessageResult {
        return $this->send('video', [
            'profileId' => $profileId,
            'to' => $to,
            'url' => $url,
            'base64' => $base64,
            'caption' => $caption,
            'mimetype' => $mimetype,
        ]);
    }

    /**
     * @param bool $ptt Send as a voice note (push-to-talk)
     */
    public function sendAudio(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $mimetype = null,
        bool $ptt = false,
    ): MessageResult {
        return $this->send('audio', [
            'profileId' => $profileId,
            'to' => $to,
            'url' => $url,
            'base64' => $base64,
            'mimetype' => $mimetype,
            'ptt' => $ptt,
        ]);
    }

    public function sendDocument(
        string $profileId,
        string $to,
        string $filename,
        ?string $url = null,
        ?string $base64 = null,
        ?string $caption = null,
        ?string $mimetype = null,
    ): MessageResult {
        return $this->send('document', [
            'profileId' => $profileId,
            'to' => $to,
            'filename' => $filename,
            'url' => $url,
            'base64' => $base64,
            'caption' => $caption,
            'mimetype' => $mimetype,
        ]);
    }

    public function sendLocation(
        string $profileId,
        string $to,
        float $latitude,
        float $longitude,
        ?string $name = null,
        ?string $address = null,
    ): MessageResult {
        return $this->send('location', [
            'profileId' => $profileId,
            'to' => $to,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'name' => $name,
            'address' => $address,
        ]);
    }

    /**
     * Sends a contact card (vCard).
     */
    public function sendContact(
        string $profileId,
        string $to,
        string $name,
        string $phone,
        ?string $email = null,
    ): MessageResult {
        return $this->send('contact', [
            'profileId' => $profileId,
            'to' => $to,
            'contacts' => [
                array_filter(['name' => $name, 'phone' => $phone, 'email' => $email], static fn ($v) => $v !== null),
            ],
        ]);
    }

    /**
     * @param string[] $options 2 to 12 answers
     */
    public function sendPoll(
        string $profileId,
        string $to,
        string $question,
        array $options,
        bool $allowMultipleAnswers = false,
    ): MessageResult {
        return $this->send('poll', [
            'profileId' => $profileId,
            'to' => $to,
            'question' => $question,
            'options' => $options,
            'allowMultipleAnswers' => $allowMultipleAnswers,
        ]);
    }

    /**
     * Reacts to a message with an emoji; an empty emoji removes the reaction.
     *
     * @param string $messageId MultiWA's message id (MessageResult::$messageId, or
     *                          `id` of a row from list()), not the WhatsApp id
     */
    public function sendReaction(
        string $profileId,
        string $messageId,
        string $emoji,
    ): MessageResult {
        return $this->send('reaction', [
            'profileId' => $profileId,
            'messageId' => $messageId,
            'emoji' => $emoji,
        ]);
    }

    /**
     * Stored messages of a profile, newest first, with their conversation.
     *
     * @param string|null $type      text, image, video, audio, document, location or contact
     * @param string|null $direction incoming or outgoing
     *
     * @return array<mixed> The message rows as the API returns them
     */
    public function list(
        string $profileId,
        int $limit = 50,
        int $offset = 0,
        ?string $type = null,
        ?string $direction = null,
    ): array {
        return $this->client->request('GET', 'messages/profile/' . rawurlencode($profileId), [
            'query' => [
                'limit' => $limit,
                'offset' => $offset,
                'type' => $type,
                'direction' => $direction,
            ],
        ]);
    }

    /**
     * @param array<string, mixed> $body
     */
    private function send(string $type, array $body): MessageResult
    {
        return MessageResult::fromArray($this->client->request('POST', "messages/{$type}", [
            'json' => array_filter($body, static fn ($v) => $v !== null),
        ]));
    }
}

<?php

declare(strict_types=1);

namespace MultiWA\Clients;

use GuzzleHttp\Client as HttpClient;
use MultiWA\Models\MessageResult;

/**
 * Messages API Client
 * 
 * Send text, images, videos, documents, locations, contacts, and polls.
 */
class MessagesClient
{
    public function __construct(
        private readonly HttpClient $http
    ) {}

    /**
     * Send a text message
     */
    public function sendText(
        string $profileId,
        string $to,
        string $text,
        ?string $quotedMessageId = null,
    ): MessageResult {
        $response = $this->http->post('messages/text', [
            'json' => [
                'profileId' => $profileId,
                'to' => $to,
                'text' => $text,
                'quotedMessageId' => $quotedMessageId,
            ],
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send an image message
     */
    public function sendImage(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $caption = null,
        ?string $mimetype = null,
    ): MessageResult {
        $response = $this->http->post('messages/image', [
            'json' => array_filter([
                'profileId' => $profileId,
                'to' => $to,
                'url' => $url,
                'base64' => $base64,
                'caption' => $caption,
                'mimetype' => $mimetype,
            ], fn($v) => $v !== null),
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send a video message
     */
    public function sendVideo(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $caption = null,
        ?string $mimetype = null,
    ): MessageResult {
        $response = $this->http->post('messages/video', [
            'json' => array_filter([
                'profileId' => $profileId,
                'to' => $to,
                'url' => $url,
                'base64' => $base64,
                'caption' => $caption,
                'mimetype' => $mimetype,
            ], fn($v) => $v !== null),
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send an audio/voice message
     */
    public function sendAudio(
        string $profileId,
        string $to,
        ?string $url = null,
        ?string $base64 = null,
        ?string $mimetype = null,
        bool $ptt = false,
    ): MessageResult {
        $response = $this->http->post('messages/audio', [
            'json' => array_filter([
                'profileId' => $profileId,
                'to' => $to,
                'url' => $url,
                'base64' => $base64,
                'mimetype' => $mimetype,
                'ptt' => $ptt,
            ], fn($v) => $v !== null),
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send a document/file
     */
    public function sendDocument(
        string $profileId,
        string $to,
        string $filename,
        ?string $url = null,
        ?string $base64 = null,
        ?string $mimetype = null,
    ): MessageResult {
        $response = $this->http->post('messages/document', [
            'json' => array_filter([
                'profileId' => $profileId,
                'to' => $to,
                'filename' => $filename,
                'url' => $url,
                'base64' => $base64,
                'mimetype' => $mimetype,
            ], fn($v) => $v !== null),
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send a location
     */
    public function sendLocation(
        string $profileId,
        string $to,
        float $latitude,
        float $longitude,
        ?string $name = null,
        ?string $address = null,
    ): MessageResult {
        $response = $this->http->post('messages/location', [
            'json' => array_filter([
                'profileId' => $profileId,
                'to' => $to,
                'latitude' => $latitude,
                'longitude' => $longitude,
                'name' => $name,
                'address' => $address,
            ], fn($v) => $v !== null),
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send a contact card (vCard)
     */
    public function sendContact(
        string $profileId,
        string $to,
        string $name,
        string $phone,
        ?string $email = null,
    ): MessageResult {
        $response = $this->http->post('messages/contact', [
            'json' => [
                'profileId' => $profileId,
                'to' => $to,
                'contacts' => [
                    [
                        'name' => $name,
                        'phone' => $phone,
                        'email' => $email,
                    ],
                ],
            ],
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * Send an interactive poll
     * 
     * @param string[] $options Poll options (2-12 items)
     */
    public function sendPoll(
        string $profileId,
        string $to,
        string $question,
        array $options,
        bool $allowMultipleAnswers = false,
    ): MessageResult {
        $response = $this->http->post('messages/poll', [
            'json' => [
                'profileId' => $profileId,
                'to' => $to,
                'question' => $question,
                'options' => $options,
                'allowMultipleAnswers' => $allowMultipleAnswers,
            ],
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * React to a message with an emoji
     */
    public function sendReaction(
        string $profileId,
        string $messageId,
        string $emoji,
    ): MessageResult {
        $response = $this->http->post('messages/reaction', [
            'json' => [
                'profileId' => $profileId,
                'messageId' => $messageId,
                'emoji' => $emoji,
            ],
        ]);

        return MessageResult::fromArray(
            json_decode($response->getBody()->getContents(), true)
        );
    }

    /**
     * List messages for a profile
     */
    public function list(
        string $profileId,
        int $limit = 50,
        int $offset = 0,
        ?string $type = null,
        ?string $direction = null,
    ): array {
        $response = $this->http->get("messages/profile/{$profileId}", [
            'query' => array_filter([
                'limit' => $limit,
                'offset' => $offset,
                'type' => $type,
                'direction' => $direction,
            ], fn($v) => $v !== null),
        ]);

        return json_decode($response->getBody()->getContents(), true);
    }
}

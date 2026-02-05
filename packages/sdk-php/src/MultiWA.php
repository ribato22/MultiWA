<?php

declare(strict_types=1);

namespace MultiWA;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\Exception\GuzzleException;
use MultiWA\Clients\MessagesClient;
use MultiWA\Clients\ContactsClient;
use MultiWA\Clients\BroadcastsClient;
use MultiWA\Clients\ProfilesClient;
use MultiWA\Clients\WebhooksClient;

/**
 * MultiWA API Client
 * 
 * Main entry point for the MultiWA PHP SDK.
 * 
 * @example
 * ```php
 * $client = new MultiWA(
 *     baseUrl: 'https://your-instance.com/api',
 *     apiKey: 'your-api-key'
 * );
 * $client->messages()->sendText($profileId, $to, 'Hello!');
 * ```
 */
class MultiWA
{
    private HttpClient $http;
    private MessagesClient $messages;
    private ContactsClient $contacts;
    private BroadcastsClient $broadcasts;
    private ProfilesClient $profiles;
    private WebhooksClient $webhooks;

    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly float $timeout = 30.0,
    ) {
        $this->http = new HttpClient([
            'base_uri' => rtrim($baseUrl, '/') . '/',
            'timeout' => $timeout,
            'headers' => [
                'X-API-Key' => $apiKey,
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
            ],
        ]);

        $this->messages = new MessagesClient($this->http);
        $this->contacts = new ContactsClient($this->http);
        $this->broadcasts = new BroadcastsClient($this->http);
        $this->profiles = new ProfilesClient($this->http);
        $this->webhooks = new WebhooksClient($this->http);
    }

    public function messages(): MessagesClient
    {
        return $this->messages;
    }

    public function contacts(): ContactsClient
    {
        return $this->contacts;
    }

    public function broadcasts(): BroadcastsClient
    {
        return $this->broadcasts;
    }

    public function profiles(): ProfilesClient
    {
        return $this->profiles;
    }

    public function webhooks(): WebhooksClient
    {
        return $this->webhooks;
    }

    /**
     * Make a raw API request
     * 
     * @param string $method HTTP method
     * @param string $path API path
     * @param array $options Guzzle options
     * @return array Response data
     * @throws GuzzleException
     */
    public function request(string $method, string $path, array $options = []): array
    {
        $response = $this->http->request($method, $path, $options);
        return json_decode($response->getBody()->getContents(), true);
    }
}

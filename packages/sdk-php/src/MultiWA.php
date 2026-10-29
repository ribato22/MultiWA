<?php

declare(strict_types=1);

namespace MultiWA;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Promise\PromiseInterface;
use MultiWA\Clients\BroadcastsClient;
use MultiWA\Clients\ContactsClient;
use MultiWA\Clients\MessagesClient;
use MultiWA\Clients\ProfilesClient;
use MultiWA\Clients\WebhooksClient;
use MultiWA\Exceptions\ApiException;
use MultiWA\Exceptions\MultiWAException;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * MultiWA API client, the entry point of the SDK.
 *
 * ```php
 * $client = new MultiWA(
 *     baseUrl: 'https://your-instance.com/api/v1',
 *     apiKey: 'your-api-key',
 * );
 * $client->messages()->sendText($profileId, '6281234567890', 'Hello!');
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

    /**
     * @param string        $baseUrl API base URL including the /api/v1 prefix,
     *                               e.g. https://your-instance.com/api/v1
     * @param string        $apiKey  API key, sent as the X-API-Key header
     * @param float         $timeout Request timeout in seconds
     * @param callable|null $handler Guzzle handler that sends the requests;
     *                               tests pass a MockHandler
     */
    public function __construct(
        string $baseUrl,
        string $apiKey,
        float $timeout = 30.0,
        ?callable $handler = null,
    ) {
        $stack = HandlerStack::create($handler);
        // Outermost (unshift, not push), so it sees the final response after
        // redirects and every failure of the inner middleware.
        $stack->unshift(self::mapErrors(), 'multiwa_errors');

        $this->http = new HttpClient([
            'base_uri' => rtrim($baseUrl, '/') . '/',
            'handler' => $stack,
            'http_errors' => false,
            'timeout' => $timeout,
            // No default Content-Type: the API (Fastify) rejects a POST without a
            // body that declares one. The `json` option sets it when there is a body.
            'headers' => [
                'X-API-Key' => $apiKey,
                'Accept' => 'application/json',
            ],
        ]);

        $this->messages = new MessagesClient($this);
        $this->contacts = new ContactsClient($this);
        $this->broadcasts = new BroadcastsClient($this);
        $this->profiles = new ProfilesClient($this);
        $this->webhooks = new WebhooksClient($this);
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
     * Calls any API route and returns the decoded JSON response.
     *
     * @param string               $path    Route below the base URL, e.g. 'messages/otp'
     * @param array<string, mixed> $options Guzzle request options, e.g. ['json' => [...]] or ['query' => [...]]
     *
     * @return array<mixed>
     *
     * @throws ApiException     The API answered with an error status
     * @throws MultiWAException The request failed without a response, or the response was not JSON
     */
    public function request(string $method, string $path, array $options = []): array
    {
        // A leading slash would resolve against the host root and drop /api/v1.
        $response = $this->http->request($method, ltrim($path, '/'), $options);

        try {
            $data = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new MultiWAException("The response to {$method} {$path} is not JSON", 0, $e);
        }
        if (!is_array($data)) {
            throw new MultiWAException("The response to {$method} {$path} is not a JSON object or array");
        }

        return $data;
    }

    /**
     * The one place errors are mapped: an error status becomes an ApiException
     * subclass; any other failure (no response, too many redirects) becomes a
     * MultiWAException.
     */
    private static function mapErrors(): callable
    {
        return static function (callable $handler): callable {
            return static function (RequestInterface $request, array $options) use ($handler): PromiseInterface {
                return $handler($request, $options)->then(
                    static function (ResponseInterface $response): ResponseInterface {
                        if ($response->getStatusCode() >= 400) {
                            throw ApiException::fromResponse($response);
                        }

                        return $response;
                    },
                    static function (mixed $reason): never {
                        $previous = $reason instanceof \Throwable ? $reason : null;

                        throw new MultiWAException($previous?->getMessage() ?? 'The request failed', 0, $previous);
                    },
                );
            };
        };
    }
}

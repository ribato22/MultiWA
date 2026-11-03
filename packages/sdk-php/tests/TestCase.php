<?php

declare(strict_types=1);

namespace MultiWA\Tests;

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Utils;
use MultiWA\MultiWA;
use PHPUnit\Framework\TestCase as PHPUnitTestCase;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

abstract class TestCase extends PHPUnitTestCase
{
    protected const BASE_URL = 'https://wa.example.com/api/v1';

    /** @var list<array{request: RequestInterface, response: ?ResponseInterface, error: mixed, options: array<mixed>}> */
    protected array $history = [];

    /** @var list<string> Each request's body, read as it was sent */
    private array $bodies = [];

    /**
     * A client whose requests get the queued responses (or exceptions) in order.
     *
     * @param list<ResponseInterface|\Throwable> $queue
     */
    protected function client(array $queue, string $baseUrl = self::BASE_URL): MultiWA
    {
        $this->history = [];
        $this->bodies = [];
        $handler = Middleware::tap(function (RequestInterface $request): void {
            $this->bodies[] = (string) $request->getBody();
        })(Middleware::history($this->history)(new MockHandler($queue)));

        return new MultiWA($baseUrl, 'test-key', handler: $handler);
    }

    /**
     * The only request, with its body as it was sent: once a request is done, the SDK detaches a stream of the
     * caller's from it, and the body can no longer be read.
     */
    protected function onlyRequest(): RequestInterface
    {
        self::assertCount(1, $this->history);

        return $this->history[0]['request']->withBody(Utils::streamFor($this->bodies[0]));
    }
}

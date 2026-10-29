<?php

declare(strict_types=1);

namespace MultiWA\Tests;

use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\Middleware;
use MultiWA\MultiWA;
use PHPUnit\Framework\TestCase as PHPUnitTestCase;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

abstract class TestCase extends PHPUnitTestCase
{
    protected const BASE_URL = 'https://wa.example.com/api/v1';

    /** @var list<array{request: RequestInterface, response: ?ResponseInterface, error: mixed, options: array<mixed>}> */
    protected array $history = [];

    /**
     * A client whose requests get the queued responses (or exceptions) in order.
     *
     * @param list<ResponseInterface|\Throwable> $queue
     */
    protected function client(array $queue, string $baseUrl = self::BASE_URL): MultiWA
    {
        $this->history = [];
        $handler = Middleware::history($this->history)(new MockHandler($queue));

        return new MultiWA($baseUrl, 'test-key', handler: $handler);
    }

    protected function onlyRequest(): RequestInterface
    {
        self::assertCount(1, $this->history);

        return $this->history[0]['request'];
    }
}

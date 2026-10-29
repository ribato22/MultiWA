<?php

declare(strict_types=1);

namespace MultiWA\Tests;

use DateTimeImmutable;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use MultiWA\Exceptions\ApiException;
use MultiWA\Exceptions\AuthenticationException;
use MultiWA\Exceptions\MultiWAException;
use MultiWA\Exceptions\NotFoundException;
use MultiWA\Exceptions\RateLimitException;
use MultiWA\Exceptions\ValidationException;

/**
 * Error responses become typed exceptions, with the bodies the API really sends.
 */
final class ErrorsTest extends TestCase
{
    public function testUnauthorized(): void
    {
        $e = $this->send(self::json(401, ['statusCode' => 401, 'message' => 'Unauthorized']));

        self::assertInstanceOf(AuthenticationException::class, $e);
        self::assertSame(401, $e->getStatusCode());
        self::assertSame(401, $e->getCode());
        self::assertSame('Unauthorized', $e->getMessage());
        self::assertNull($e->getErrorCode());
    }

    public function testForbidden(): void
    {
        $e = $this->send(self::json(403, ['statusCode' => 403, 'message' => 'Resource not found in your organization', 'error' => 'Forbidden']));

        self::assertInstanceOf(AuthenticationException::class, $e);
        self::assertSame('Resource not found in your organization', $e->getMessage());
        self::assertNull($e->getErrorCode());
    }

    public function testNotFound(): void
    {
        $e = $this->send(self::json(404, ['statusCode' => 404, 'message' => 'Profile not found', 'error' => 'Not Found']));

        self::assertInstanceOf(NotFoundException::class, $e);
        self::assertSame(404, $e->getStatusCode());
        self::assertSame('Profile not found', $e->getMessage());
    }

    public function testProfileDisconnected(): void
    {
        $body = ['statusCode' => 409, 'error' => 'PROFILE_DISCONNECTED', 'message' => 'Profile is not connected; the message was not sent'];
        $e = $this->send(self::json(409, $body));

        self::assertSame(ApiException::class, $e::class);
        self::assertInstanceOf(ApiException::class, $e);
        self::assertSame(409, $e->getStatusCode());
        self::assertSame('PROFILE_DISCONNECTED', $e->getErrorCode());
        self::assertSame('Profile is not connected; the message was not sent', $e->getMessage());
        self::assertSame($body, $e->getResponseBody());
    }

    public function testValidationErrorList(): void
    {
        $e = $this->send(self::json(422, [
            'statusCode' => 422,
            'message' => ['to must be a phone number or a WhatsApp JID', 'text should not be empty'],
            'error' => 'Unprocessable Entity',
        ]));

        self::assertInstanceOf(ValidationException::class, $e);
        self::assertSame(422, $e->getStatusCode());
        self::assertSame(['to must be a phone number or a WhatsApp JID', 'text should not be empty'], $e->getErrors());
        self::assertSame('to must be a phone number or a WhatsApp JID; text should not be empty', $e->getMessage());
        self::assertNull($e->getErrorCode());
    }

    public function testBadRequestWithOneMessage(): void
    {
        $e = $this->send(self::json(400, ['statusCode' => 400, 'message' => 'Poll must have at least 2 options', 'error' => 'Bad Request']));

        self::assertInstanceOf(ValidationException::class, $e);
        self::assertSame(['Poll must have at least 2 options'], $e->getErrors());
    }

    public function testDailyLimitReached(): void
    {
        $e = $this->send(self::json(429, [
            'error' => 'DAILY_LIMIT_REACHED',
            'lane' => 'service',
            'limit' => 1000,
            'count' => 1000,
            'resetAt' => '2026-10-28T17:00:00.000Z',
        ]));

        self::assertInstanceOf(RateLimitException::class, $e);
        self::assertSame(429, $e->getStatusCode());
        self::assertSame('DAILY_LIMIT_REACHED', $e->getErrorCode());
        self::assertSame('DAILY_LIMIT_REACHED', $e->getMessage());
        self::assertEquals(new DateTimeImmutable('2026-10-28T17:00:00Z'), $e->getRetryAt());
        self::assertSame(1000, $e->getResponseBody()['limit']);
    }

    public function testColdCircuitOpen(): void
    {
        $e = $this->send(self::json(429, ['error' => 'COLD_CIRCUIT_OPEN', 'lane' => 'cold', 'retryAt' => '2026-10-28T09:30:00.000Z']));

        self::assertInstanceOf(RateLimitException::class, $e);
        self::assertSame('COLD_CIRCUIT_OPEN', $e->getErrorCode());
        self::assertEquals(new DateTimeImmutable('2026-10-28T09:30:00Z'), $e->getRetryAt());
    }

    public function testRepeatSuppressed(): void
    {
        $before = new DateTimeImmutable();
        $e = $this->send(self::json(429, ['error' => 'REPEAT_SUPPRESSED', 'retryInMs' => 1500]));

        self::assertInstanceOf(RateLimitException::class, $e);
        self::assertSame('REPEAT_SUPPRESSED', $e->getErrorCode());
        $retryAt = $e->getRetryAt();
        self::assertNotNull($retryAt);
        // 1.5 s, rounded up to whole seconds.
        self::assertGreaterThanOrEqual($before->getTimestamp() + 2, $retryAt->getTimestamp());
        self::assertLessThanOrEqual(time() + 2, $retryAt->getTimestamp());
    }

    public function testRequestRateLimitWithoutRetryTime(): void
    {
        $e = $this->send(self::json(429, ['statusCode' => 429, 'message' => 'ThrottlerException: Too Many Requests']));

        self::assertInstanceOf(RateLimitException::class, $e);
        self::assertNull($e->getErrorCode());
        self::assertNull($e->getRetryAt());
    }

    public function testServerError(): void
    {
        $e = $this->send(self::json(500, ['statusCode' => 500, 'message' => 'Internal server error']));

        self::assertSame(ApiException::class, $e::class);
        self::assertInstanceOf(ApiException::class, $e);
        self::assertSame(500, $e->getStatusCode());
        self::assertSame('Internal server error', $e->getMessage());
    }

    public function testOtpDeliveryFailed(): void
    {
        $client = $this->client([self::json(502, ['error' => 'OTP_DELIVERY_FAILED', 'channel' => 'primary', 'reason' => 'ACK_TIMEOUT'])]);

        try {
            $client->request('POST', 'messages/otp', ['json' => ['profileId' => 'prof-1', 'to' => '6281234567890', 'text' => 'Code 123456', 'code' => '123456']]);
            self::fail('No exception was thrown');
        } catch (ApiException $e) {
            self::assertSame(502, $e->getStatusCode());
            self::assertSame('OTP_DELIVERY_FAILED', $e->getErrorCode());
            self::assertSame('ACK_TIMEOUT', $e->getResponseBody()['reason']);
        }
    }

    public function testErrorPageThatIsNotJson(): void
    {
        $e = $this->send(new Response(502, ['Content-Type' => 'text/html'], '<html><body>502 Bad Gateway</body></html>'));

        self::assertSame(ApiException::class, $e::class);
        self::assertInstanceOf(ApiException::class, $e);
        self::assertSame('HTTP 502 Bad Gateway', $e->getMessage());
        self::assertSame([], $e->getResponseBody());
    }

    public function testConnectionError(): void
    {
        $cause = new ConnectException('cURL error 7: Failed to connect to wa.example.com', new Request('POST', self::BASE_URL . '/messages/text'));
        $e = $this->send($cause);

        self::assertSame(MultiWAException::class, $e::class);
        self::assertSame('cURL error 7: Failed to connect to wa.example.com', $e->getMessage());
        self::assertSame($cause, $e->getPrevious());
    }

    public function testTooManyRedirects(): void
    {
        $redirect = new Response(302, ['Location' => self::BASE_URL . '/messages/text']);
        $client = $this->client(array_fill(0, 6, $redirect));

        try {
            $client->messages()->sendText('prof-1', '6281234567890', 'Hello');
            self::fail('No exception was thrown');
        } catch (MultiWAException $e) {
            // Failures of Guzzle's own middleware are mapped too.
            self::assertSame(MultiWAException::class, $e::class);
            self::assertInstanceOf(\GuzzleHttp\Exception\TooManyRedirectsException::class, $e->getPrevious());
        }
    }

    public function testSuccessThatIsNotJson(): void
    {
        $e = $this->send(new Response(200, [], 'OK'));

        self::assertSame(MultiWAException::class, $e::class);
        self::assertInstanceOf(\JsonException::class, $e->getPrevious());
    }

    private function send(Response|\Throwable $reply): MultiWAException
    {
        $client = $this->client([$reply]);

        try {
            $client->messages()->sendText('prof-1', '6281234567890', 'Hello');
        } catch (MultiWAException $e) {
            return $e;
        }

        self::fail('No exception was thrown');
    }

    /**
     * @param array<mixed> $body
     */
    private static function json(int $status, array $body): Response
    {
        return new Response($status, ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR));
    }
}

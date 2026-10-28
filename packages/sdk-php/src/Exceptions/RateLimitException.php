<?php

declare(strict_types=1);

namespace MultiWA\Exceptions;

use DateTimeImmutable;

/**
 * 429: a send limit was hit. getErrorCode() says which one:
 * DAILY_LIMIT_REACHED, COLD_DAILY_LIMIT_REACHED, COLD_CIRCUIT_OPEN or
 * REPEAT_SUPPRESSED (null for the API's general request-rate limit).
 */
class RateLimitException extends ApiException
{
    private readonly ?DateTimeImmutable $retryAt;

    /**
     * @param array<mixed> $responseBody
     */
    public function __construct(string $message, int $statusCode, array $responseBody = [])
    {
        parent::__construct($message, $statusCode, $responseBody);

        $at = $responseBody['resetAt'] ?? $responseBody['retryAt'] ?? null;
        $inMs = $responseBody['retryInMs'] ?? null;
        $this->retryAt = match (true) {
            is_string($at) => self::parseDate($at),
            // Relative, so it is anchored to when the response arrived.
            is_int($inMs) => new DateTimeImmutable('+' . (int) ceil($inMs / 1000) . ' seconds'),
            default => null,
        };
    }

    /**
     * When sending may work again: `resetAt` of a daily limit, `retryAt` of an
     * open cold circuit, or now plus `retryInMs` of a suppressed repeat. Null
     * when the response does not say.
     */
    public function getRetryAt(): ?DateTimeImmutable
    {
        return $this->retryAt;
    }

    private static function parseDate(string $value): ?DateTimeImmutable
    {
        try {
            return new DateTimeImmutable($value);
        } catch (\Exception) {
            return null;
        }
    }
}

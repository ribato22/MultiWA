<?php

declare(strict_types=1);

namespace MultiWA\Exceptions;

use Psr\Http\Message\ResponseInterface;

/**
 * The API answered with an HTTP error status (4xx or 5xx).
 *
 * The status code is also the exception code. Specific statuses throw a
 * subclass: {@see ValidationException} (400, 422), {@see AuthenticationException}
 * (401, 403), {@see NotFoundException} (404) and {@see RateLimitException} (429).
 */
class ApiException extends MultiWAException
{
    /**
     * @param array<mixed> $responseBody
     */
    public function __construct(
        string $message,
        private readonly int $statusCode,
        private readonly array $responseBody = [],
    ) {
        parent::__construct($message, $statusCode);
    }

    public static function fromResponse(ResponseInterface $response): self
    {
        $status = $response->getStatusCode();
        $body = json_decode((string) $response->getBody(), true);
        $body = is_array($body) ? $body : [];

        // NestJS puts the reason in `message` (a list for validation errors); the
        // send gate's 429 and the OTP 502 only carry an `error` code.
        $message = $body['message'] ?? null;
        if (is_array($message)) {
            $message = implode('; ', array_filter($message, 'is_string'));
        }
        if (!is_string($message) || $message === '') {
            $error = $body['error'] ?? null;
            $message = is_string($error) && $error !== ''
                ? $error
                : trim("HTTP {$status} {$response->getReasonPhrase()}");
        }

        return match ($status) {
            400, 422 => new ValidationException($message, $status, $body),
            401, 403 => new AuthenticationException($message, $status, $body),
            404 => new NotFoundException($message, $status, $body),
            429 => new RateLimitException($message, $status, $body),
            default => new self($message, $status, $body),
        };
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    /**
     * The machine-readable reason, such as PROFILE_DISCONNECTED or
     * DAILY_LIMIT_REACHED: the body's `error` when it is an UPPER_SNAKE code.
     * Null for the generic HTTP phrases NestJS puts there ("Bad Request").
     */
    public function getErrorCode(): ?string
    {
        $error = $this->responseBody['error'] ?? null;

        return is_string($error) && preg_match('/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/', $error) === 1 ? $error : null;
    }

    /**
     * The decoded JSON error body, or an empty array when it was not JSON.
     *
     * @return array<mixed>
     */
    public function getResponseBody(): array
    {
        return $this->responseBody;
    }
}

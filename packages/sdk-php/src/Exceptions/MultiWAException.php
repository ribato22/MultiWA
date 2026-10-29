<?php

declare(strict_types=1);

namespace MultiWA\Exceptions;

/**
 * Base class of everything the SDK throws.
 *
 * Thrown as-is when no usable response came back: the connection failed or
 * timed out, or a successful response was not JSON. HTTP error statuses throw
 * an {@see ApiException} subclass instead.
 */
class MultiWAException extends \RuntimeException
{
}

<?php

declare(strict_types=1);

namespace MultiWA\Models;

/**
 * A page of a profile's calls, newest first.
 */
class CallPage
{
    /**
     * @param list<Call> $calls
     */
    public function __construct(
        public readonly array $calls = [],
        /** Pass it as `cursor` for the next page; null on the last one. */
        public readonly ?string $nextCursor = null,
    ) {
    }

    /**
     * @param array<mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            calls: array_values(array_map(static fn (array $row) => Call::fromArray($row), $data['calls'] ?? [])),
            nextCursor: $data['nextCursor'] ?? null,
        );
    }
}

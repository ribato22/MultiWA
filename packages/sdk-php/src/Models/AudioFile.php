<?php

declare(strict_types=1);

namespace MultiWA\Models;

/**
 * Audio the API answered with: a call's recording (audio/webm), or a profile's announcement.
 */
class AudioFile
{
    public function __construct(
        /** The bytes, as sent. */
        public readonly string $content,
        /** The Content-Type, e.g. audio/webm. */
        public readonly string $contentType,
    ) {
    }
}

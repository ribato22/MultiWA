<?php

declare(strict_types=1);

namespace MultiWA\Exceptions;

/**
 * 400 or 422: the API rejected the request input.
 */
class ValidationException extends ApiException
{
    /**
     * Every validation message, e.g. ["to must be a phone number or a WhatsApp JID"].
     *
     * @return string[]
     */
    public function getErrors(): array
    {
        $message = $this->getResponseBody()['message'] ?? null;
        if (is_string($message)) {
            return [$message];
        }

        return is_array($message) ? array_values(array_filter($message, 'is_string')) : [];
    }
}

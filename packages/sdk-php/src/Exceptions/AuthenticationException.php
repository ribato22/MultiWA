<?php

declare(strict_types=1);

namespace MultiWA\Exceptions;

/**
 * 401: the API key is missing, wrong or expired. 403: the key may not do this,
 * for example a missing scope, or a profile or resource outside its organization.
 */
class AuthenticationException extends ApiException
{
}

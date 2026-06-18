// MultiWA Gateway - reusable OpenAPI response decorators
// apps/api/src/common/decorators/api-responses.ts
//
// Standard, documented error responses so the Swagger docs are consistent and
// complete across every endpoint. Compose with applyDecorators on controllers.

import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

const validationExample = {
  statusCode: 400,
  message: ['to must be a WhatsApp phone number or JID'],
  error: 'Bad Request',
};

/** 400 — class-validator rejected the request body/params. */
export function ApiValidationError() {
  return ApiBadRequestResponse({
    description: 'Validation failed — the `message` array lists the offending fields.',
    schema: { example: validationExample },
  });
}

/** 401 + 403 — auth errors common to every protected endpoint. */
export function ApiAuthErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description: 'Missing or invalid JWT / API key.',
      schema: { example: { statusCode: 401, message: 'Unauthorized' } },
    }),
    ApiForbiddenResponse({
      description: 'Authenticated, but the resource is outside your organization/workspace.',
      schema: { example: { statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' } },
    }),
  );
}

/** 404 — addressed resource does not exist (or not in your tenant). */
export function ApiNotFound(resource = 'Resource') {
  return ApiNotFoundResponse({
    description: `${resource} not found.`,
    schema: { example: { statusCode: 404, message: `${resource} not found`, error: 'Not Found' } },
  });
}

/** 429 — per-profile daily send limit reached. */
export function ApiRateLimited() {
  return ApiTooManyRequestsResponse({
    description: 'Per-profile daily send limit reached. Retry after the limit resets (00:00 WIB).',
    schema: { example: { statusCode: 429, message: 'Daily message limit reached', error: 'Too Many Requests' } },
  });
}

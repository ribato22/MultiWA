// MultiWA Gateway API - API-key Scope Decorator
// apps/api/src/modules/auth/decorators/require-scope.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const API_KEY_SCOPE = 'multiwa_api_key_scope';

/**
 * Declare the API-key scope(s) a route requires. Enforced by ApiKeyScopeGuard,
 * which reads `req.user.apiKeyScopes` (present only for API-key auth).
 *
 * Semantics: the guard passes when the key carries ANY of the listed scopes.
 * Backward-compat escape hatches: a key with NO scopes (`[]`) or a wildcard `*`
 * is full-access, and JWT-authenticated requests are unaffected (no apiKeyScopes).
 *
 * The scopes are the values the dashboard issues to API keys (`apps/admin/src/app/dashboard/api-keys/page.tsx`).
 *
 * @example
 * @RequireScope('messages:write')
 */
export const RequireScope = (...scopes: string[]) => SetMetadata(API_KEY_SCOPE, scopes);

// MultiWA Gateway API - API-key Scope Decorator
// apps/api/src/modules/auth/decorators/require-scope.decorator.ts

import { SetMetadata } from '@nestjs/common';

// Distinct from the RBAC RequirePermissions/'permissions' metadata (rbac.guard.ts)
// so the two guards never cross-read each other's metadata.
export const API_KEY_SCOPE = 'multiwa_api_key_scope';

/**
 * Declare the API-key scope(s) a route requires. Enforced by ApiKeyScopeGuard,
 * which reads `req.user.apiKeyScopes` (present only for API-key auth).
 *
 * Semantics: the guard passes when the key carries ANY of the listed scopes.
 * Backward-compat escape hatches: a key with NO scopes (`[]`) or a wildcard `*`
 * is full-access, and JWT-authenticated requests are unaffected (no apiKeyScopes).
 *
 * Scope vocabulary = the PERMISSIONS keys in rbac.service.ts (e.g. `message:send`,
 * `message:read`, `contact:read`, …) plus `*`.
 *
 * @example
 * @RequireScope('message:send')
 */
export const RequireScope = (...scopes: string[]) => SetMetadata(API_KEY_SCOPE, scopes);

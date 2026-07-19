// MultiWA Gateway API - API-key Scope Guard
// apps/api/src/modules/auth/guards/api-key-scope.guard.ts

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_KEY_SCOPE } from '../decorators/require-scope.decorator';

/**
 * Enforces `@RequireScope(...)` for API-key-authenticated requests. Must run AFTER
 * an auth guard that populates `req.user` (e.g. JwtOrApiKeyGuard).
 *
 * No-op unless BOTH: (a) the route declares `@RequireScope`, AND (b) the caller is
 * an API key with an explicit, non-wildcard scope list. This keeps every existing
 * key (`[]` -> full access) and every JWT login (no apiKeyScopes) working unchanged.
 * Mirrors RolesGuard — Reflector-only, so no provider/module registration is needed.
 */
@Injectable()
export class ApiKeyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(API_KEY_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true; // route declares no scope
    }

    const req = context.switchToHttp().getRequest();
    const scopes: string[] | undefined = req.user?.apiKeyScopes;

    // JWT auth (or no principal): API-key scopes don't apply. JWT authorization is
    // handled by RolesGuard/RbacGuard/TenantGuard, not here.
    if (scopes === undefined) {
      return true;
    }

    // Backward-compat: an unscoped or wildcard key is full-access.
    if (scopes.length === 0 || scopes.includes('*')) {
      return true;
    }

    if (!required.some((s) => scopes.includes(s))) {
      throw new ForbiddenException(`API key missing required scope(s): ${required.join(', ')}`);
    }
    return true;
  }
}

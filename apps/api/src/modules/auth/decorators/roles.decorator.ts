// MultiWA Gateway API - Roles Decorator
// apps/api/src/modules/auth/decorators/roles.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or controller) to callers whose organization role is one of
 * `roles`. Enforced by RolesGuard, which reads `req.user.role`. Org roles:
 * `owner`, `admin`, `member`, `viewer`.
 *
 * Example: `@Roles('owner', 'admin')`
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

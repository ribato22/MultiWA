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
export const Roles = (...roles: string[]) => {
  // An empty list reads as naming no role, which is wider than any list; on a method it would even override the
  // controller's roles. Refused at load, where it is written.
  if (!roles.length) throw new Error('@Roles() needs at least one role');
  return SetMetadata(ROLES_KEY, roles);
};

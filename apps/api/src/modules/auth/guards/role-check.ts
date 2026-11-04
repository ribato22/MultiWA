// MultiWA Gateway API - who may call a route
// apps/api/src/modules/auth/guards/role-check.ts

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SERVER_OWNER_KEY } from '../decorators/server-owner.decorator';
import { isServerOwner } from '../server-owner';
import { ANY_ROLES } from '../roles';

/** The methods that only read: all a viewer may call on a route that names no role. */
export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Who may call the route, checked by the auth guards once the caller is signed in. Only the four roles get through: a
 * missing or unknown role (another case, a made-up name) is refused everywhere, even where a route names no role. The
 * route's `@Roles` (else its controller's) lists the roles; `@ServerOwnerOnly()` also asks for the server's owner. A
 * route that names no role may be read by the four roles, and is read-only for a viewer.
 */
export async function assertRole(reflector: Reflector, context: ExecutionContext): Promise<void> {
  const targets = [context.getHandler(), context.getClass()];
  const allowed = reflector.getAllAndOverride<readonly string[] | undefined>(ROLES_KEY, targets);
  const req = context.switchToHttp().getRequest();
  const user = req.user;
  if (!ANY_ROLES.includes(user?.role)) throw new ForbiddenException('Insufficient role for this action');
  if (allowed?.length) {
    if (!user?.role || !allowed.includes(user.role)) throw new ForbiddenException('Insufficient role for this action');
  } else if (user?.role === 'viewer' && !READ_METHODS.has(req.method)) {
    throw new ForbiddenException('This role is read-only');
  }
  if (reflector.getAllAndOverride<boolean | undefined>(SERVER_OWNER_KEY, targets) && !(await isServerOwner(user))) {
    throw new ForbiddenException("Only the server's owner manages server-wide settings");
  }
}

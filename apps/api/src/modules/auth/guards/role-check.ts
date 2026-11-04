// MultiWA Gateway API - who may call a route
// apps/api/src/modules/auth/guards/role-check.ts

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SERVER_OWNER_KEY } from '../decorators/server-owner.decorator';
import { isServerOwner } from '../server-owner';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Who may call the route, checked by the auth guards once the caller is signed in. The route's `@Roles` (else its
 * controller's) lists the roles; `@ServerOwnerOnly()` also asks for the server's owner. A route that names no role is
 * open to every role for reading, and read-only for a viewer.
 */
export async function assertRole(reflector: Reflector, context: ExecutionContext): Promise<void> {
  const targets = [context.getHandler(), context.getClass()];
  const allowed = reflector.getAllAndOverride<readonly string[] | undefined>(ROLES_KEY, targets);
  const req = context.switchToHttp().getRequest();
  const user = req.user;
  if (allowed?.length) {
    if (!user?.role || !allowed.includes(user.role)) throw new ForbiddenException('Insufficient role for this action');
  } else if (user?.role === 'viewer' && !READS.has(req.method)) {
    throw new ForbiddenException('This role is read-only');
  }
  if (reflector.getAllAndOverride<boolean | undefined>(SERVER_OWNER_KEY, targets) && !(await isServerOwner(user))) {
    throw new ForbiddenException("Only the server's owner manages server-wide settings");
  }
}

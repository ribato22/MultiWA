// MultiWA Gateway - RBAC Guard
// apps/api/src/modules/rbac/rbac.guard.ts

import { Injectable, CanActivate, ExecutionContext, SetMetadata, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService, Permission } from './rbac.service';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const REQUIRE_ANY_KEY = 'requireAny';
export const RequireAnyPermission = (...permissions: Permission[]) => {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, propertyKey!, descriptor!);
    SetMetadata(REQUIRE_ANY_KEY, true)(target, propertyKey!, descriptor!);
  };
};

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('Authentication required');
    }

    // Get organizationId from request (query, params, or body)
    const organizationId =
      request.query?.organizationId ||
      request.params?.organizationId ||
      request.body?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization context required');
    }

    // Check if requireAny is set
    const requireAny = this.reflector.getAllAndOverride<boolean>(REQUIRE_ANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    let hasPermission: boolean;
    if (requireAny) {
      hasPermission = await this.rbacService.hasAnyPermission(
        user.id,
        organizationId,
        requiredPermissions,
      );
    } else {
      hasPermission = await this.rbacService.hasAllPermissions(
        user.id,
        organizationId,
        requiredPermissions,
      );
    }

    if (!hasPermission) {
      throw new ForbiddenException(
        `Missing required permission(s): ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

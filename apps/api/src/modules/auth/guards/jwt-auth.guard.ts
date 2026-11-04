// MultiWA Gateway API - JWT Auth Guard
// apps/api/src/modules/auth/guards/jwt-auth.guard.ts

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { assertRole } from './role-check';

// Each guard signs the caller in, then checks who may call the route (@Roles): in one guard, so a route's @Roles can
// never go unchecked for want of a second one. `super()` takes no options: the AuthGuard mixin injects them itself.

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;
    await assertRole(this.reflector, context);
    return true;
  }
}

@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard(['jwt', 'api-key']) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;
    await assertRole(this.reflector, context);
    return true;
  }
}

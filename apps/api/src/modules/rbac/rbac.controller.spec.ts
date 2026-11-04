// RbacController at the HTTP edge: who may call it. Roles and who holds them are owner and admin business, and the
// role check runs before the tenant guard's lookups. RbacService is pinned by rbac.service.spec.ts.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RbacController } from './rbac.controller';

describe('RbacController', () => {
  it('is for owners and admins only, checked before the tenant lookups', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RbacController)).toEqual([JwtOrApiKeyGuard, RolesGuard, TenantGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, RbacController)).toEqual(['owner', 'admin']);
  });

  it('no route widens it', () => {
    const proto = RbacController.prototype as unknown as Record<string, unknown>;
    const widened = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor' && Reflect.getMetadata(ROLES_KEY, proto[name] as object) !== undefined);
    expect(widened).toEqual([]);
  });
});

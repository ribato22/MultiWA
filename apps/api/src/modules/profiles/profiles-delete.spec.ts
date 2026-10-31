// Deleting a profile deletes every recording file of it, and only owners and admins delete recordings: so only they
// delete a profile, by either route, and an API key with a scope list needs profiles:write (the admin's "Manage
// Profiles"). Both routes stay tenant-checked.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TENANT_CHECK, type TenantCheck } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { API_KEY_SCOPE } from '../auth/decorators/require-scope.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AccountsController } from '../accounts/accounts.controller';
import { ProfilesController } from './profiles.controller';

const ROUTES: Array<[string, { prototype: object }, string, TenantCheck[]]> = [
  ['DELETE /profiles/:id', ProfilesController, 'delete', [{ from: 'param', key: 'id', resource: 'profile' }]],
  ['DELETE /accounts/:accountId/profiles/:profileId', AccountsController, 'deleteProfile', [
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  ]],
];

describe.each(ROUTES)('%s', (_route, controller, name, tenantChecks) => {
  const handler = (controller.prototype as Record<string, object>)[name];

  // @Roles and @RequireScope check nothing without their guards: these run after the class's authentication and
  // tenant check.
  it('owner and admin only, and an API key with a scope list needs profiles:write', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([JwtOrApiKeyGuard, TenantGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ApiKeyScopeGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(API_KEY_SCOPE, handler)).toEqual(['profiles:write']);
  });

  it('on a profile of their organization', () => {
    expect(Reflect.getMetadata(TENANT_CHECK, handler)).toEqual(tenantChecks);
  });
});

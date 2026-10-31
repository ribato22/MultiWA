// The call settings are owner/admin only, and tenant-checked on the profile.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

vi.mock('./calls.service', () => ({ CallsService: class {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TENANT_CHECK } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { ProfileCallsController } from './profile-calls.controller';
import { CallsController } from './calls.controller';

describe('call settings and status routes', () => {
  it('PUT /profiles/:id/calls-settings: owner and admin only, on a profile of their organization', async () => {
    const handler = ProfileCallsController.prototype.updateCallSettings;
    // @Roles checks nothing without RolesGuard: it runs after authentication, before the tenant lookup.
    expect(Reflect.getMetadata(GUARDS_METADATA, ProfileCallsController)).toEqual([JwtOrApiKeyGuard, ApiKeyScopeGuard, RolesGuard, TenantGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(TENANT_CHECK, handler)).toEqual([{ from: 'param', key: 'id', resource: 'profile' }]);
    const calls = { updateCallSettings: vi.fn().mockResolvedValue({ profileId: 'p1', answerInDashboard: true }) };
    expect(await new ProfileCallsController(calls as any).updateCallSettings('p1', { answerInDashboard: true })).toEqual({ profileId: 'p1', answerInDashboard: true });
    expect(calls.updateCallSettings).toHaveBeenCalledWith('p1', { answerInDashboard: true });
  });

  it('GET /calls/media/status: owner and admin only, scoped by their organization', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CallsController.prototype.mediaStatus)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(GUARDS_METADATA, CallsController.prototype.mediaStatus)).toEqual([RolesGuard]);
  });
});

// The call settings are owner/admin only, tenant-checked on the profile, and audited.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of } from 'rxjs';

vi.mock('./calls.service', () => ({ CallsService: class {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TENANT_CHECK } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
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

  it('PUT /profiles/:id/calls-settings is audited as profile.calls_settings, with the value it set', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const put = (body: unknown) => {
      const req = { method: 'PUT', params: { id: 'p1' }, body, user: { id: 'u1', organizationId: 'o1' }, headers: {} };
      const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getClass: () => ProfileCallsController,
        getHandler: () => ProfileCallsController.prototype.updateCallSettings,
      };
      return lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({ profileId: 'p1' }) }));
    };
    await put({ answerInDashboard: false });
    expect(audit.log).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'profile.calls_settings', userId: 'u1', organizationId: 'o1', resourceId: 'p1',
      metadata: { answerInDashboard: false, targetId: 'p1', status: 'success' },
    }));
    await put({ answerInDashboard: 'yes' }); // not a value it can set (the pipe refuses it)
    expect(audit.log.mock.lastCall![0].metadata).toEqual({ targetId: 'p1', status: 'success' });
  });

  it('GET /calls/media/status: owner and admin only, scoped by their organization', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CallsController.prototype.mediaStatus)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(GUARDS_METADATA, CallsController.prototype.mediaStatus)).toEqual([RolesGuard]);
  });
});

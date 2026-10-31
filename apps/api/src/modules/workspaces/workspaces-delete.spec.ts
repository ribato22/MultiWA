// Deleting a workspace deletes its profiles, calls and recording rows (the cascade), and the nightly sweep then their
// recording files. Only owners and admins delete recordings: so only they delete a workspace, still tenant-checked.
// The controller takes logins only (JwtAuthGuard), so no API key reaches the route, and it needs no scope.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TENANT_CHECK } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkspacesController } from './workspaces.controller';

describe('DELETE /workspaces/:id', () => {
  const handler = WorkspacesController.prototype.delete;

  // @Roles checks nothing without its guard, which runs after the class's authentication and tenant check. Should the
  // class ever take API keys, the route needs an API-key scope as the profile deletes have.
  it('owner and admin only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WorkspacesController)).toEqual([JwtAuthGuard, TenantGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['owner', 'admin']);
  });

  it('on a workspace of their organization', () => {
    expect(Reflect.getMetadata(TENANT_CHECK, handler)).toEqual([{ from: 'param', key: 'id', resource: 'workspace' }]);
  });
});

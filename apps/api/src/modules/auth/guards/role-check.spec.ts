// assertRole: who may call a route, as the two auth guards check it right after sign-in.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

vi.mock('../server-owner', () => ({ isServerOwner: vi.fn() }));

import { isServerOwner } from '../server-owner';
import { Roles } from '../decorators/roles.decorator';
import { ServerOwnerOnly } from '../decorators/server-owner.decorator';
import { ADMIN_ROLES, AGENT_ROLES } from '../roles';
import { assertRole, READ_METHODS } from './role-check';

class Routes {
  open() {}
  @Roles(...ADMIN_ROLES) admins() {}
  @Roles('owner') @ServerOwnerOnly() serverSettings() {}
}

@Roles(...ADMIN_ROLES)
class AdminRoutes {
  @Roles(...AGENT_ROLES) agents() {}
  inherits() {}
}

const reflector = new Reflector();
const check = (Controller: any, handler: string, method: string, role?: string) =>
  assertRole(reflector, {
    getHandler: () => Controller.prototype[handler],
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ method, user: role === undefined ? undefined : { role, organizationId: 'org-1' } }) }),
  } as unknown as ExecutionContext);

describe('assertRole', () => {
  beforeEach(() => vi.mocked(isServerOwner).mockReset());

  it('lets the four roles read a route that names no role', async () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) await expect(check(Routes, 'open', 'GET', role)).resolves.toBeUndefined();
  });

  it('lets a viewer make every kind of read', async () => {
    expect(READ_METHODS).toEqual(new Set(['GET', 'HEAD', 'OPTIONS']));
    for (const method of ['HEAD', 'OPTIONS']) await expect(check(Routes, 'open', method, 'viewer')).resolves.toBeUndefined();
  });

  it.each([
    ['no caller', 'GET', undefined],
    ['a role in another case', 'POST', 'Viewer'],
    ['a role that is not one of the four', 'GET', 'superadmin'],
  ])('refuses %s, even on a route that names no role', async (_who, method, role) => {
    const refused = check(Routes, 'open', method, role);
    await expect(refused).rejects.toThrow(ForbiddenException);
    await expect(refused).rejects.toThrow('Insufficient role for this action');
  });

  it('keeps a route that names no role read-only for a viewer, and open to the other roles', async () => {
    await expect(check(Routes, 'open', 'POST', 'viewer')).rejects.toThrow('This role is read-only');
    await expect(check(Routes, 'open', 'POST', 'member')).resolves.toBeUndefined();
  });

  it("lets only the route's roles call it, whatever the method", async () => {
    await expect(check(Routes, 'admins', 'GET', 'admin')).resolves.toBeUndefined();
    await expect(check(Routes, 'admins', 'GET', 'member')).rejects.toThrow(ForbiddenException);
    await expect(check(Routes, 'admins', 'DELETE', 'viewer')).rejects.toThrow(ForbiddenException);
  });

  it('refuses a caller without a role on a route that names roles', async () => {
    const refused = check(Routes, 'admins', 'GET');
    await expect(refused).rejects.toThrow(ForbiddenException);
    await expect(refused).rejects.toThrow('Insufficient role for this action');
  });

  it("takes the method's roles over the controller's, and the controller's when the method names none", async () => {
    await expect(check(AdminRoutes, 'agents', 'POST', 'member')).resolves.toBeUndefined();
    await expect(check(AdminRoutes, 'inherits', 'POST', 'member')).rejects.toThrow(ForbiddenException);
  });

  it("asks for the server's owner on top of the role", async () => {
    vi.mocked(isServerOwner).mockResolvedValueOnce(false);
    await expect(check(Routes, 'serverSettings', 'PUT', 'owner')).rejects.toThrow("Only the server's owner");
    vi.mocked(isServerOwner).mockResolvedValueOnce(true);
    await expect(check(Routes, 'serverSettings', 'PUT', 'owner')).resolves.toBeUndefined();
    await expect(check(Routes, 'serverSettings', 'PUT', 'admin')).rejects.toThrow('Insufficient role');
    expect(isServerOwner).toHaveBeenCalledTimes(2); // the admin was refused on the role, before any lookup
  });
});

describe('@Roles', () => {
  it('cannot be written without a role, which would read as naming none', () => {
    expect(() => Roles()).toThrow('@Roles() needs at least one role');
  });
});

// RbacService unit tests — locks the role/permission invariants that guard
// tenant isolation and privilege escalation: system roles are immutable/undeletable,
// permission strings are validated on write, permission checks deny by default,
// and — critically — role assignment derives the organization from the ROLE
// (never from client input) so a user can't be pushed into an arbitrary org.
// Prisma is mocked; the service takes no constructor deps, so no DB is touched.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    role: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userRole: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from '@multiwa/database';
import { RbacService } from './rbac.service';

const R = prisma.role as any;
const UR = prisma.userRole as any;

describe('RbacService', () => {
  let service: RbacService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RbacService();
  });

  describe('createRole', () => {
    it('rejects a duplicate role name within the same org', async () => {
      R.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.createRole({ organizationId: 'org-1', name: 'Support', permissions: [] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(R.create).not.toHaveBeenCalled();
    });

    it('rejects unknown permission keys before writing', async () => {
      R.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.createRole({
          organizationId: 'org-1',
          name: 'Support',
          permissions: ['message:send', 'god:mode'],
        } as any),
      ).rejects.toThrow(/Invalid permissions: god:mode/);
      expect(R.create).not.toHaveBeenCalled();
    });

    it('creates a NON-system role (isSystem forced false, cannot be set by caller)', async () => {
      R.findFirst.mockResolvedValueOnce(null);
      R.create.mockResolvedValueOnce({ id: 'new' });
      await service.createRole({
        organizationId: 'org-1',
        name: 'Support',
        permissions: ['message:send', 'message:read'],
        // attacker attempts to smuggle a system flag — DTO/service must ignore it
        isSystem: true,
      } as any);
      expect(R.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: 'org-1', isSystem: false }),
      });
    });
  });

  describe('updateRole / deleteRole guards', () => {
    it('refuses to modify a system role', async () => {
      R.findUnique.mockResolvedValueOnce({ id: 'r1', isSystem: true, users: [] });
      await expect(service.updateRole('r1', { name: 'x' } as any)).rejects.toThrow(
        'Cannot modify system role',
      );
      expect(R.update).not.toHaveBeenCalled();
    });

    it('refuses to delete a system role, and refuses to delete a role that still has users', async () => {
      R.findUnique.mockResolvedValueOnce({ id: 'r1', isSystem: true, users: [] });
      await expect(service.deleteRole('r1')).rejects.toThrow('Cannot delete system role');

      R.findUnique.mockResolvedValueOnce({ id: 'r2', isSystem: false, users: [{ id: 'ur1' }] });
      await expect(service.deleteRole('r2')).rejects.toThrow('Remove all users');
      expect(R.delete).not.toHaveBeenCalled();
    });
  });

  describe('assignRole — cross-org invariant', () => {
    it('throws NotFound when the target role does not exist', async () => {
      R.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.assignRole({ userId: 'u1', roleId: 'missing' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(UR.create).not.toHaveBeenCalled();
    });

    it("derives organizationId from the ROLE, not the client, when creating an assignment", async () => {
      // The role belongs to org-A; the client never supplies an org — so the
      // membership must be pinned to the role's own org (no cross-tenant assign).
      R.findUnique.mockResolvedValueOnce({ id: 'role-1', organizationId: 'org-A' });
      UR.findUnique.mockResolvedValueOnce(null);
      UR.create.mockResolvedValueOnce({ id: 'ur-new' });

      await service.assignRole({ userId: 'u1', roleId: 'role-1' } as any);

      expect(UR.findUnique).toHaveBeenCalledWith({
        where: { userId_organizationId: { userId: 'u1', organizationId: 'org-A' } },
      });
      expect(UR.create).toHaveBeenCalledWith({
        data: { userId: 'u1', roleId: 'role-1', organizationId: 'org-A' },
      });
    });

    it('updates the existing membership (one role per user per org) instead of duplicating', async () => {
      R.findUnique.mockResolvedValueOnce({ id: 'role-2', organizationId: 'org-A' });
      UR.findUnique.mockResolvedValueOnce({ id: 'ur-1' });
      UR.update.mockResolvedValueOnce({ id: 'ur-1' });

      await service.assignRole({ userId: 'u1', roleId: 'role-2' } as any);

      expect(UR.create).not.toHaveBeenCalled();
      expect(UR.update).toHaveBeenCalledWith({ where: { id: 'ur-1' }, data: { roleId: 'role-2' } });
    });
  });

  describe('getUserRoles — tenant scoping', () => {
    it('scopes the query to the given org so callers cannot enumerate cross-tenant memberships', async () => {
      UR.findMany.mockResolvedValueOnce([]);
      await service.getUserRoles('u1', 'org-A');
      expect(UR.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', organizationId: 'org-A' } }),
      );
    });
  });

  describe('permission resolution', () => {
    it('denies by default when the user has no role in the org', async () => {
      UR.findUnique.mockResolvedValue(null);
      expect(await service.hasPermission('u1', 'org-A', 'message:send' as any)).toBe(false);
      expect(await service.getUserPermissions('u1', 'org-A')).toEqual([]);
    });

    it('resolves granted vs missing permissions from the assigned role', async () => {
      const role = { permissions: ['message:send', 'message:read'] };
      UR.findUnique.mockResolvedValue({ role });

      expect(await service.hasPermission('u1', 'org-A', 'message:send' as any)).toBe(true);
      expect(await service.hasPermission('u1', 'org-A', 'org:delete' as any)).toBe(false);
      // any: one match is enough; all: every one must be present
      expect(
        await service.hasAnyPermission('u1', 'org-A', ['org:delete', 'message:read'] as any),
      ).toBe(true);
      expect(
        await service.hasAllPermissions('u1', 'org-A', ['message:send', 'org:delete'] as any),
      ).toBe(false);
    });
  });
});

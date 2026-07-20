// OrganizationsService Unit Tests — locks the owner-role security invariants of
// member management: `owner` is never assignable through addMember/updateMemberRole,
// the owner row can never be re-roled or removed, an admin can't remove themselves,
// duplicate emails are rejected, and new members get a temp password (never the
// caller-supplied one). Prisma + bcrypt are mocked so these run without a DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('bcrypt', () => ({
  hash: vi.fn(async () => 'HASH'),
  compare: vi.fn(async () => true),
  default: { hash: vi.fn(async () => 'HASH'), compare: vi.fn(async () => true) },
}));

import { prisma } from '@multiwa/database';
import * as bcrypt from 'bcrypt';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService — member-management invariants', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.findFirst).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.delete).mockReset();
    vi.mocked(bcrypt.hash).mockClear();
    service = new OrganizationsService();
  });

  describe('assertAssignableRole (via addMember / updateMemberRole)', () => {
    it('addMember rejects the "owner" role — ownership is not mintable here', async () => {
      await expect(
        service.addMember('org-1', { email: 'a@x.io', name: 'A', role: 'owner' }),
      ).rejects.toThrow(BadRequestException);
      // Bailed out before any DB lookup / write.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('addMember rejects an unknown role', async () => {
      await expect(
        service.addMember('org-1', { email: 'a@x.io', name: 'A', role: 'superadmin' }),
      ).rejects.toThrow(/Invalid role/);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('updateMemberRole rejects the "owner" role before touching the member', async () => {
      await expect(
        service.updateMemberRole('org-1', 'm-1', 'owner'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('addMember', () => {
    it('rejects a duplicate email and never creates a user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'dupe' } as any);
      await expect(
        service.addMember('org-1', { email: 'taken@x.io', name: 'Dup' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates a member with a generated temp password (hashed, not stored plaintext) and returns it', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: 'm-9',
        name: 'New',
        email: 'new@x.io',
        role: 'member',
        isActive: true,
        createdAt: new Date(0),
      } as any);

      const result = await service.addMember('org-1', { email: 'new@x.io', name: 'New' });

      // A temp password is returned to the caller...
      expect(typeof result.temporaryPassword).toBe('string');
      expect(result.temporaryPassword.length).toBeGreaterThan(0);

      // ...and it is what got hashed, while the DB row stores only the hash.
      expect(bcrypt.hash).toHaveBeenCalledTimes(1);
      const [hashedInput] = vi.mocked(bcrypt.hash).mock.calls[0];
      expect(hashedInput).toBe(result.temporaryPassword);

      const createArg = vi.mocked(prisma.user.create).mock.calls[0][0] as any;
      expect(createArg.data.passwordHash).toBe('HASH');
      expect(createArg.data.role).toBe('member'); // defaults to member when omitted
      expect(createArg.data).not.toHaveProperty('temporaryPassword');
    });

    it('mints a fresh random temp password each call (not a predictable constant)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'x' } as any);

      const a = await service.addMember('org-1', { email: 'a@x.io', name: 'A' });
      const b = await service.addMember('org-1', { email: 'b@x.io', name: 'B' });
      expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
    });
  });

  describe('updateMemberRole', () => {
    it('throws NotFound when the member is absent', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
      await expect(
        service.updateMemberRole('org-1', 'ghost', 'admin'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to re-role an existing owner (Forbidden) even for a valid target role', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'owner-1', role: 'owner' } as any);
      await expect(
        service.updateMemberRole('org-1', 'owner-1', 'admin'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates a normal member to a valid role', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'm-1', role: 'member' } as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({ id: 'm-1', role: 'admin' } as any);
      const out = await service.updateMemberRole('org-1', 'm-1', 'admin');
      expect(out).toEqual({ id: 'm-1', role: 'admin' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'm-1' }, data: { role: 'admin' } }),
      );
    });
  });

  describe('removeMember', () => {
    it('refuses self-removal before any DB read', async () => {
      await expect(
        service.removeMember('org-1', 'me', 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to remove the organization owner (Forbidden)', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'owner-1', role: 'owner' } as any);
      await expect(
        service.removeMember('org-1', 'admin-1', 'owner-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes a normal member and returns success', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: 'm-1', role: 'member' } as any);
      vi.mocked(prisma.user.delete).mockResolvedValueOnce({ id: 'm-1' } as any);
      const out = await service.removeMember('org-1', 'admin-1', 'm-1');
      expect(out).toEqual({ success: true });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
    });
  });
});

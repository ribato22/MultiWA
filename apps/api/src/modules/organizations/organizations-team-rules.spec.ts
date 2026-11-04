// Team rules: an admin adds, changes and removes members and viewers only; making someone admin, changing an admin
// and removing one are the owner's; nobody changes their own role. The owner stays untouchable (organizations.service.spec).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
vi.mock('bcrypt', () => ({ hash: vi.fn().mockResolvedValue('hash') }));

import { prisma } from '@multiwa/database';
import { OrganizationsService } from './organizations.service';

const users = prisma.user as unknown as Record<'findUnique' | 'findFirst' | 'create' | 'update' | 'delete', ReturnType<typeof vi.fn>>;
const OWNER = { id: 'u-owner', role: 'owner' };
const ADMIN = { id: 'u-admin', role: 'admin' };

describe('team rules', () => {
  const service = new OrganizationsService();

  beforeEach(() => {
    for (const fn of Object.values(users)) fn.mockReset();
    users.findUnique.mockResolvedValue(null);
    users.create.mockImplementation(async ({ data }: any) => ({ id: 'u-new', role: data.role }));
    users.update.mockImplementation(async ({ data }: any) => ({ id: 'u-x', role: data.role }));
    users.delete.mockResolvedValue({});
  });

  it('an admin adds members and viewers, but not an admin', async () => {
    await expect(service.addMember('org-1', ADMIN, { email: 'v@x.io', name: 'V', role: 'viewer' })).resolves.toMatchObject({ role: 'viewer' });
    await expect(service.addMember('org-1', ADMIN, { email: 'a@x.io', name: 'A', role: 'admin' })).rejects.toThrow(ForbiddenException);
    expect(users.findUnique).toHaveBeenCalledTimes(1);
    expect(users.create).toHaveBeenCalledTimes(1);
  });

  it('the owner adds an admin', async () => {
    await expect(service.addMember('org-1', OWNER, { email: 'a@x.io', name: 'A', role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
  });

  it('an admin neither makes anyone admin nor changes an admin', async () => {
    users.findFirst.mockResolvedValueOnce({ id: 'u-member', role: 'member' });
    await expect(service.updateMemberRole('org-1', ADMIN, 'u-member', 'admin')).rejects.toThrow(ForbiddenException);
    users.findFirst.mockResolvedValueOnce({ id: 'u-admin-2', role: 'admin' });
    await expect(service.updateMemberRole('org-1', ADMIN, 'u-admin-2', 'member')).rejects.toThrow(ForbiddenException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('an admin moves a member to viewer, and the owner changes an admin', async () => {
    users.findFirst.mockResolvedValueOnce({ id: 'u-member', role: 'member' });
    await expect(service.updateMemberRole('org-1', ADMIN, 'u-member', 'viewer')).resolves.toMatchObject({ role: 'viewer' });
    users.findFirst.mockResolvedValueOnce({ id: 'u-admin-2', role: 'admin' });
    await expect(service.updateMemberRole('org-1', OWNER, 'u-admin-2', 'member')).resolves.toMatchObject({ role: 'member' });
  });

  it('nobody changes their own role, and nothing is looked up for it', async () => {
    await expect(service.updateMemberRole('org-1', ADMIN, ADMIN.id, 'member')).rejects.toThrow(BadRequestException);
    expect(users.findFirst).not.toHaveBeenCalled();
  });

  it('an admin does not remove an admin; the owner does', async () => {
    users.findFirst.mockResolvedValueOnce({ id: 'u-admin-2', role: 'admin' });
    await expect(service.removeMember('org-1', ADMIN, 'u-admin-2')).rejects.toThrow(ForbiddenException);
    users.findFirst.mockResolvedValueOnce({ id: 'u-admin-2', role: 'admin' });
    await expect(service.removeMember('org-1', OWNER, 'u-admin-2')).resolves.toEqual({ success: true });
    expect(users.delete).toHaveBeenCalledTimes(1);
  });
});

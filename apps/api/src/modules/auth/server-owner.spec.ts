// isServerOwner: the owner of the oldest organization, and nobody else.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { organization: { findFirst: vi.fn(), count: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { assertServerOwnerMayLeave, isServerOwner } from './server-owner';

const findFirst = prisma.organization.findFirst as unknown as ReturnType<typeof vi.fn>;

describe('isServerOwner', () => {
  beforeEach(() => findFirst.mockReset().mockResolvedValue({ id: 'org-first' }));

  it('is the owner of the oldest organization', async () => {
    await expect(isServerOwner({ role: 'owner', organizationId: 'org-first' })).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  });

  it('is not the owner of a later organization', async () => {
    await expect(isServerOwner({ role: 'owner', organizationId: 'org-later' })).resolves.toBe(false);
  });

  it('is never an admin or a missing caller, and looks nothing up for them', async () => {
    await expect(isServerOwner({ role: 'admin', organizationId: 'org-first' })).resolves.toBe(false);
    await expect(isServerOwner(undefined)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('is never an owner without an organization, and looks nothing up for them', async () => {
    await expect(isServerOwner({ role: 'owner' })).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(0);
  });
});

describe('assertServerOwnerMayLeave', () => {
  const count = prisma.organization.count as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: 'org-first' });
    count.mockReset();
  });

  it("refuses the server's owner while other organizations use the server", async () => {
    count.mockResolvedValueOnce(2);
    await expect(assertServerOwnerMayLeave({ role: 'owner', organizationId: 'org-first' })).rejects.toThrow(ForbiddenException);
    expect(count).toHaveBeenCalledWith({ where: { id: { not: 'org-first' } } });
  });

  it("lets the server's owner go when theirs is the only organization", async () => {
    count.mockResolvedValueOnce(0);
    await expect(assertServerOwnerMayLeave({ role: 'owner', organizationId: 'org-first' })).resolves.toBeUndefined();
  });

  it('lets anyone else go, and counts nothing for them', async () => {
    await expect(assertServerOwnerMayLeave({ role: 'owner', organizationId: 'org-later' })).resolves.toBeUndefined();
    await expect(assertServerOwnerMayLeave({ role: 'admin', organizationId: 'org-first' })).resolves.toBeUndefined();
    expect(count).not.toHaveBeenCalled();
  });
});

// isServerOwner: the owner of the oldest organization, and nobody else.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { organization: { findFirst: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { isServerOwner } from './server-owner';

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

  it('is never an admin or a caller without a role, and looks nothing up for them', async () => {
    await expect(isServerOwner({ role: 'admin', organizationId: 'org-first' })).resolves.toBe(false);
    await expect(isServerOwner(undefined)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

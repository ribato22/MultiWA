// GDPR erasure: the server's owner cannot erase their account while other organizations use the server, and that is
// checked before anything is deleted.
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { pushSubscription: { deleteMany: vi.fn() } } }));
vi.mock('../auth/server-owner', () => ({ assertServerOwnerMayLeave: vi.fn() }));

import { prisma } from '@multiwa/database';
import { assertServerOwnerMayLeave } from '../auth/server-owner';
import { GdprController } from './gdpr.controller';

describe('GdprController.deleteAccount', () => {
  it("refuses the server's owner while other organizations use the server, before deleting anything", async () => {
    vi.mocked(assertServerOwnerMayLeave).mockRejectedValueOnce(new ForbiddenException('refused'));
    const req = { user: { id: 'u1', role: 'owner', organizationId: 'org-1' } };
    await expect(new GdprController().deleteAccount(req)).rejects.toThrow(ForbiddenException);
    expect(assertServerOwnerMayLeave).toHaveBeenCalledWith(req.user);
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled();
  });
});

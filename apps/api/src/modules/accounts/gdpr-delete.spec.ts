// GDPR erasure keeps the user's organization, so an owner is refused before anything is deleted: an owner deletes
// their account with DELETE /auth/account, which deletes the organization with it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
vi.mock('@multiwa/database', () => ({
  prisma: new Proxy({}, { get: (_, model) => (model === 'user' ? { delete: vi.fn().mockResolvedValue({}) } : { deleteMany }) }),
}));

import { GdprController } from './gdpr.controller';

describe('GdprController.deleteAccount', () => {
  beforeEach(() => deleteMany.mockClear());

  it('refuses an owner before deleting anything, and names the route that deletes an owner', async () => {
    const req = { user: { id: 'u1', role: 'owner', organizationId: 'org-1' } };
    const refused = new GdprController().deleteAccount(req);
    await expect(refused).rejects.toThrow(ForbiddenException);
    await expect(refused).rejects.toThrow('DELETE /auth/account');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it.each(['admin', 'member', 'viewer'])('erases a %s', async (role) => {
    const req = { user: { id: 'u2', role, organizationId: 'org-1' } };
    await expect(new GdprController().deleteAccount(req)).resolves.toBeDefined();
    expect(deleteMany).toHaveBeenCalled();
  });
});

// MultiWA Gateway API - the server's owner
// apps/api/src/modules/auth/server-owner.ts

import { prisma } from '@multiwa/database';

/**
 * The owner of the oldest organization: whoever set this server up. Server-wide settings (SMTP, storage) are theirs
 * alone; an owner or admin of another organization on the same server does not reach them.
 */
export async function isServerOwner(user: { role?: string; organizationId?: string } | undefined): Promise<boolean> {
  if (user?.role !== 'owner' || !user.organizationId) return false;
  const first = await prisma.organization.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  return first?.id === user.organizationId;
}

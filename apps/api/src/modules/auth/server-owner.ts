// MultiWA Gateway API - the server's owner
// apps/api/src/modules/auth/server-owner.ts

import { ForbiddenException } from '@nestjs/common';
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

/**
 * The server's owner may not delete their account while other organizations use the server: server ownership would
 * pass to the owner of the next-oldest organization, whom nobody chose, or to nobody.
 */
export async function assertServerOwnerMayLeave(user: { role?: string; organizationId?: string } | undefined): Promise<void> {
  if (!(await isServerOwner(user))) return;
  const others = await prisma.organization.count({ where: { id: { not: user!.organizationId } } });
  if (others > 0) throw new ForbiddenException("The server's owner cannot delete their account while other organizations use this server");
}

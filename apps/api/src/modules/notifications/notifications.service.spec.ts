// An organization's bell rings for every active user, or only for the roles given: an alert that only an owner or admin
// can act on, and that the others should not read, names its roles.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { user: { findMany: vi.fn() }, notification: { create: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { NotificationsService, NotificationType } from './notifications.service';

const db = prisma as any;
const SELECT = { id: true, email: true, preferences: true };

describe('NotificationsService.createForOrg', () => {
  // Neither email nor push configured: the bell only.
  const service = new NotificationsService({ enabled: false } as any, { enabled: false } as any);
  beforeEach(() => {
    db.user.findMany.mockReset().mockResolvedValue([{ id: 'u1', email: 'owner@example.com', preferences: {} }]);
    db.notification.create.mockReset().mockResolvedValue({ id: 'n1' });
  });

  it('every active user of the organization, without roles', async () => {
    expect(await service.createForOrg('o1', NotificationType.SYSTEM, 'Title', 'Body', { kind: 'k' })).toEqual([{ id: 'n1' }]);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { organizationId: 'o1', isActive: true }, select: SELECT });
    expect(db.notification.create).toHaveBeenCalledWith({ data: { userId: 'u1', type: 'system', title: 'Title', body: 'Body', metadata: { kind: 'k' } } });
  });

  it('only the active users of the roles given', async () => {
    await service.createForOrg('o1', NotificationType.SYSTEM, 'Title', 'Body', { kind: 'k' }, ['owner', 'admin']);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { organizationId: 'o1', isActive: true, role: { in: ['owner', 'admin'] } }, select: SELECT });
  });
});

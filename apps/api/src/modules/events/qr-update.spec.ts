// qr:update links a phone to the profile, so it reaches only the owners and admins in the profile's room, by their
// role when the QR is sent, not when they joined.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { user: { findMany: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { EventsGateway } from './events.gateway';

const findMany = prisma.user.findMany as unknown as ReturnType<typeof vi.fn>;
const socket = (principalUserId?: string) => ({ data: principalUserId ? { principalUserId } : {}, emit: vi.fn() });

describe('EventsGateway.emitQrUpdate', () => {
  const admin = socket('u-admin');
  const member = socket('u-member');
  const viewerKey = socket('u-viewer');
  const unknown = socket();
  let gateway: EventsGateway;
  const room = (sockets: unknown[]) => ({ in: vi.fn(() => ({ fetchSockets: async () => sockets })) }) as any;

  beforeEach(() => {
    for (const s of [admin, member, viewerKey, unknown]) s.emit.mockReset();
    findMany.mockReset().mockResolvedValue([{ id: 'u-admin' }]);
    gateway = new EventsGateway({} as any, { emit: vi.fn() } as any);
    gateway.server = room([admin, member, viewerKey, unknown]);
  });

  it('sends the QR to the owners and admins of the room only', async () => {
    await gateway.emitQrUpdate('p1', 'data:qr');
    expect(gateway.server.in).toHaveBeenCalledWith('profile:p1');
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-admin', 'u-member', 'u-viewer'] }, isActive: true, role: { in: ['owner', 'admin'] } }, select: { id: true } });
    expect(admin.emit).toHaveBeenCalledWith('qr:update', { profileId: 'p1', qrCode: 'data:qr' });
    for (const s of [member, viewerKey, unknown]) expect(s.emit).not.toHaveBeenCalled();
  });

  it('looks nobody up for an empty room, and a failed lookup sends nothing', async () => {
    gateway.server = room([]);
    await gateway.emitQrUpdate('p1', 'data:qr');
    expect(findMany).not.toHaveBeenCalled();
    gateway.server = room([admin]);
    findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(gateway.emitQrUpdate('p1', 'data:qr')).resolves.toBeUndefined();
    expect(admin.emit).not.toHaveBeenCalled();
  });

  it('a join records whose socket it is', async () => {
    const client = { id: 's1', connected: true, data: {} as Record<string, unknown>, join: vi.fn() };
    vi.spyOn(gateway as any, 'authOf').mockResolvedValue({ userId: 'u-member', organizationId: 'o1' });
    vi.spyOn(gateway as any, 'ownsProfile').mockResolvedValue(true);
    await expect(gateway.handleJoin(client as any, { profileId: 'p1' })).resolves.toEqual({ success: true, profileId: 'p1' });
    expect(client.data.principalUserId).toBe('u-member');
  });
});

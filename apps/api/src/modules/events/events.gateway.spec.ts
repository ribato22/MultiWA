// EventsGateway join: Nest does not await handleConnection before it dispatches the
// client's messages, and every admin page emits `join` on `connect`. A join that
// arrives while the handshake is still being authenticated must wait for it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findUnique: vi.fn() },
    profile: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { EventsGateway } from './events.gateway';

const db = prisma as any;

const fakeClient = () =>
  ({ id: 's1', handshake: { auth: { token: 't' } }, data: {}, join: vi.fn(), disconnect: vi.fn() }) as any;

describe('EventsGateway join during the handshake', () => {
  let gateway: EventsGateway;
  let finishAuth: () => void;

  beforeEach(() => {
    const verified = new Promise((resolve) => {
      finishAuth = () => resolve({ sub: 'u1' });
    });
    gateway = new EventsGateway({ verifyAsync: vi.fn(() => verified) } as any);
    db.user.findUnique.mockReset().mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: true });
    db.apiKey.findUnique.mockReset().mockResolvedValue(null);
    db.profile.findFirst.mockReset().mockResolvedValue({ id: 'p1' });
  });

  it('a join sent before the handshake is authenticated waits for it and joins', async () => {
    const client = fakeClient();
    const connected = gateway.handleConnection(client); // not awaited, as in Nest
    const joined = gateway.handleJoin(client, { profileId: 'p1' });
    finishAuth();
    await connected;

    await expect(joined).resolves.toEqual({ success: true, profileId: 'p1' });
    expect(client.join).toHaveBeenCalledWith('profile:p1');
    expect(db.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', workspace: { organizationId: 'o1' } } }),
    );
  });

  it('still denies the join when the handshake fails authentication', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const client = fakeClient();
    const connected = gateway.handleConnection(client);
    const joined = gateway.handleJoin(client, { profileId: 'p1' });
    finishAuth();
    await connected;

    await expect(joined).resolves.toEqual({ success: false, error: 'Forbidden' });
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('still denies a profile of another organization', async () => {
    db.profile.findFirst.mockResolvedValue(null);
    const client = fakeClient();
    finishAuth();
    await gateway.handleConnection(client);

    await expect(gateway.handleJoin(client, { profileId: 'p2' })).resolves.toEqual({ success: false, error: 'Forbidden' });
    expect(client.join).not.toHaveBeenCalled();
  });
});

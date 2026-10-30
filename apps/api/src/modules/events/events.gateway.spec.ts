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
    gateway = new EventsGateway({ verifyAsync: vi.fn(() => verified) } as any, { emit: vi.fn() } as any);
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
    expect(client.join).not.toHaveBeenCalledWith('profile:p2');
  });
});

describe('EventsGateway users: one authentication per socket, a room per user, presence', () => {
  const rooms = new Map<string, Set<string>>();
  const emitted = vi.fn();
  let bus: { emit: ReturnType<typeof vi.fn> };
  let gateway: EventsGateway;
  let verify: ReturnType<typeof vi.fn>;
  // socket.io's in-memory adapter: join adds the socket to the room; the room goes when its last socket leaves
  const socket = (id: string, auth: Record<string, unknown> = { token: 't' }) =>
    ({
      id,
      handshake: { auth },
      data: {},
      join: vi.fn((room: string) => (rooms.get(room) ?? rooms.set(room, new Set()).get(room)!).add(id)),
      disconnect: vi.fn(),
    }) as any;
  const leave = (s: any) => {
    for (const [room, ids] of rooms) if (ids.delete(s.id) && !ids.size) rooms.delete(room);
  };

  beforeEach(() => {
    rooms.clear();
    emitted.mockReset();
    bus = { emit: vi.fn() };
    verify = vi.fn().mockResolvedValue({ sub: 'u1' });
    gateway = new EventsGateway({ verifyAsync: verify } as any, bus as any);
    gateway.server = { adapter: { rooms }, to: vi.fn(() => ({ emit: emitted })) } as any;
    db.user.findUnique.mockReset().mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: true });
    db.apiKey.findUnique.mockReset().mockResolvedValue(null);
  });

  it('authenticates a socket once, whichever gateway asks first (Nest runs the gateways\' hooks in no set order)', async () => {
    const s = socket('s1');
    const [a, b] = await Promise.all([gateway.authOf(s), gateway.authOf(s)]);
    await gateway.handleConnection(s);
    expect(a).toEqual({ userId: 'u1', organizationId: 'o1' });
    expect(b).toBe(a);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("puts every socket in its user's room, and says when the user comes online and goes offline", async () => {
    const s1 = socket('s1');
    const s2 = socket('s2');
    await gateway.handleConnection(s1);
    await gateway.handleConnection(s2);
    expect(s1.join).toHaveBeenCalledWith('user:u1');
    expect(gateway.onlineUserIds()).toEqual(['u1']);
    expect(gateway.isUserOnline('u1')).toBe(true);
    expect(bus.emit.mock.calls).toEqual([['internal.ws.user_online', { userId: 'u1' }]]); // the first socket only
    leave(s1); // socket.io takes a socket out of its rooms before 'disconnect'
    await gateway.handleDisconnect(s1);
    expect(bus.emit).toHaveBeenCalledTimes(1); // u1 still has s2
    leave(s2);
    await gateway.handleDisconnect(s2);
    expect(bus.emit).toHaveBeenLastCalledWith('internal.ws.user_offline', { userId: 'u1' });
    expect(gateway.isUserOnline('u1')).toBe(false);
  });

  it('an API-key socket carries its key\'s scopes; a JWT socket none', async () => {
    db.apiKey.findUnique.mockResolvedValue({ expiresAt: null, permissions: ['messages:read'], user: { id: 'u2', organizationId: 'o1', isActive: true } });
    expect(await gateway.authOf(socket('s3', { apiKey: 'k' }))).toEqual({ userId: 'u2', organizationId: 'o1', apiKeyScopes: ['messages:read'] });
  });

  it("emits once to every socket of several users, and to nobody for none", () => {
    gateway.emitToUsers(['u1', 'u2'], 'call:ringing', { callId: 'c1' });
    expect((gateway.server as any).to).toHaveBeenCalledWith(['user:u1', 'user:u2']);
    expect(emitted).toHaveBeenCalledWith('call:ringing', { callId: 'c1' });
    gateway.emitToUsers([], 'call:ringing', {});
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('a socket that never authenticated joins no room and changes no presence', async () => {
    verify.mockRejectedValue(new Error('bad token'));
    const s = socket('s4');
    await gateway.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalledWith(true);
    await gateway.handleDisconnect(s);
    expect(bus.emit).not.toHaveBeenCalled();
  });
});

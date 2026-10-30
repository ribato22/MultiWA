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
  ({ id: 's1', handshake: { auth: { token: 't' } }, data: {}, connected: true, join: vi.fn(), disconnect: vi.fn() }) as any;

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
  const socket = (id: string, auth: Record<string, unknown> = { token: 't' }) => {
    const s: any = {
      id,
      handshake: { auth },
      data: {},
      connected: true,
      join: vi.fn((room: string) => s.connected && (rooms.get(room) ?? rooms.set(room, new Set()).get(room)!).add(id)),
      disconnect: vi.fn(),
    };
    return s;
  };
  // socket.io closing a socket, before its 'disconnect': out of its rooms, its join made a no-op, no longer connected
  const leave = (s: any) => {
    for (const [room, ids] of rooms) if (ids.delete(s.id) && !ids.size) rooms.delete(room);
    s.connected = false;
  };
  /** The next JWT check ends only when the returned function is called. */
  const pendingVerify = () => {
    let finish!: () => void;
    verify.mockReturnValueOnce(new Promise((resolve) => (finish = () => resolve({ sub: 'u1' }))));
    return finish;
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
    gateway.handleDisconnect(s1);
    expect(bus.emit).toHaveBeenCalledTimes(1); // u1 still has s2
    leave(s2);
    gateway.handleDisconnect(s2);
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
    gateway.handleDisconnect(s);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('a socket whose authentication throws (the database is down) is refused like an unauthenticated one; nothing rejects', async () => {
    db.apiKey.findUnique.mockRejectedValue(new Error('connection refused\nforged line'));
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    const s = socket('s7', { apiKey: 'k' });
    await expect(gateway.authOf(s)).resolves.toBeNull();
    await expect(gateway.handleConnection(s)).resolves.toBeUndefined();
    expect(s.disconnect).toHaveBeenCalledWith(true);
    expect(s.join).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection refusedforged line'));
    await expect(gateway.handleJoin(s, { profileId: 'p1' })).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it("an API-key socket (an integration) joins no user room and keeps no one online; the same user's dashboard login does", async () => {
    db.apiKey.findUnique.mockResolvedValue({ expiresAt: null, permissions: [], user: { id: 'u1', organizationId: 'o1', isActive: true } });
    const integration = socket('s5', { apiKey: 'k' });
    await gateway.handleConnection(integration);
    expect(integration.join).not.toHaveBeenCalled();
    expect(integration.disconnect).not.toHaveBeenCalled();
    expect(gateway.isUserOnline('u1')).toBe(false);
    // ...yet it still gets its profiles' events
    db.profile.findFirst.mockResolvedValue({ id: 'p1' });
    expect(await gateway.handleJoin(integration, { profileId: 'p1' })).toEqual({ success: true, profileId: 'p1' });
    expect(integration.join).toHaveBeenCalledWith('profile:p1');
    const dashboard = socket('s6');
    await gateway.handleConnection(dashboard);
    expect(dashboard.join).toHaveBeenCalledWith('user:u1');
    expect(gateway.onlineUserIds()).toEqual(['u1']);
    leave(dashboard);
    gateway.handleDisconnect(dashboard);
    expect(gateway.isUserOnline('u1')).toBe(false); // the integration's socket is still open
    leave(integration);
    gateway.handleDisconnect(integration);
    expect(bus.emit.mock.calls).toEqual([
      ['internal.ws.user_online', { userId: 'u1' }],
      ['internal.ws.user_offline', { userId: 'u1' }],
    ]);
  });

  it('a key whose scopes column is NULL still makes an API-key socket: it joins no user room', async () => {
    db.apiKey.findUnique.mockResolvedValue({ expiresAt: null, permissions: null, user: { id: 'u1', organizationId: 'o1', isActive: true } });
    const s = socket('s9', { apiKey: 'k' });
    expect(await gateway.authOf(s)).toEqual({ userId: 'u1', organizationId: 'o1', apiKeyScopes: [] });
    await gateway.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(gateway.isUserOnline('u1')).toBe(false);
  });

  it('a profile join whose socket left while it was being authenticated joins and records nothing', async () => {
    const finish = pendingVerify();
    const s = socket('s10');
    db.profile.findFirst.mockResolvedValue({ id: 'p1' });
    const joined = gateway.handleJoin(s, { profileId: 'p1' });
    leave(s);
    gateway.handleDisconnect(s);
    finish();
    expect(await joined).toEqual({ success: false, error: 'Disconnected' });
    expect(s.join).not.toHaveBeenCalled();
    expect((gateway as any).clients.has('p1')).toBe(false);
  });

  it('a socket that leaves while it is being authenticated changes no presence (the user has no other socket)', async () => {
    const finish = pendingVerify();
    const s = socket('s8');
    const connecting = gateway.handleConnection(s); // not awaited, as in Nest
    leave(s);
    gateway.handleDisconnect(s);
    finish();
    await connecting;
    expect(s.join).not.toHaveBeenCalled();
    expect(gateway.isUserOnline('u1')).toBe(false);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("a socket that leaves while it is being authenticated changes no presence (the user's other socket stays)", async () => {
    const s1 = socket('s1');
    await gateway.handleConnection(s1);
    const finish = pendingVerify();
    const s2 = socket('s2');
    const connecting = gateway.handleConnection(s2);
    leave(s2);
    gateway.handleDisconnect(s2);
    finish();
    await connecting;
    expect(s2.join).not.toHaveBeenCalled();
    expect(bus.emit.mock.calls).toEqual([['internal.ws.user_online', { userId: 'u1' }]]); // s1's, once
    leave(s1);
    gateway.handleDisconnect(s1);
    expect(bus.emit.mock.calls).toEqual([
      ['internal.ws.user_online', { userId: 'u1' }],
      ['internal.ws.user_offline', { userId: 'u1' }],
    ]);
  });
});

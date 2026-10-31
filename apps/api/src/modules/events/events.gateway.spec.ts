// EventsGateway join: Nest does not await handleConnection before it dispatches the
// client's messages, and every admin page emits `join` on `connect`. A join that
// arrives while the handshake is still being authenticated must wait for it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@multiwa/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { findUnique: vi.fn() },
    profile: { findFirst: vi.fn() },
    session: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { EventsGateway } from './events.gateway';

const db = prisma as any;
/** The sessions table's key of an access token (SessionsService.hashToken). */
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
/** A session that is still live: it expires in a week. */
const liveSession = () => ({ expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000) });

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
    db.session.findUnique.mockReset().mockResolvedValue(liveSession());
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
  const sockets = new Map<string, any>(); // the namespace's connected sockets
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
    sockets.set(id, s);
    return s;
  };
  // socket.io closing a socket, before its 'disconnect': out of its rooms, its join made a no-op, no longer connected
  const leave = (s: any) => {
    for (const [room, ids] of rooms) if (ids.delete(s.id) && !ids.size) rooms.delete(room);
    sockets.delete(s.id);
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
    sockets.clear();
    emitted.mockReset();
    bus = { emit: vi.fn() };
    verify = vi.fn().mockResolvedValue({ sub: 'u1' });
    gateway = new EventsGateway({ verifyAsync: verify } as any, bus as any);
    gateway.server = { adapter: { rooms }, sockets, to: vi.fn(() => ({ emit: emitted })) } as any;
    db.user.findUnique.mockReset().mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: true });
    db.apiKey.findUnique.mockReset().mockResolvedValue(null);
    db.session.findUnique.mockReset().mockResolvedValue(liveSession());
    db.session.findMany.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('authenticates a socket once, whichever gateway asks first (Nest runs the gateways\' hooks in no set order)', async () => {
    const s = socket('s1');
    const [a, b] = await Promise.all([gateway.authOf(s), gateway.authOf(s)]);
    await gateway.handleConnection(s);
    expect(a).toEqual({ userId: 'u1', organizationId: 'o1', sessionTokenHash: hash('t') });
    expect(b).toBe(a);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("a JWT whose session is gone (logged out, revoked) or expired opens no socket, as on the HTTP API", async () => {
    db.session.findUnique.mockResolvedValueOnce(null);
    const revoked = socket('s11');
    await gateway.handleConnection(revoked);
    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(revoked.join).not.toHaveBeenCalled();
    db.session.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1_000) });
    expect(await gateway.authOf(socket('s12'))).toBeNull();
    expect(gateway.isUserOnline('u1')).toBe(false);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it("a JWT socket's principal carries its session's hash, never the token", async () => {
    const token = 'eyJ.the-access-token.sig';
    const principal = await gateway.authOf(socket('s13', { token }));
    expect(principal).toEqual({ userId: 'u1', organizationId: 'o1', sessionTokenHash: hash(token) });
    expect(JSON.stringify(principal)).not.toContain(token);
    expect(db.session.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hash(token) }, select: { expiresAt: true } });
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

  it("the sweep disconnects exactly the dashboard sockets whose session is gone or whose user was deactivated, with one query", async () => {
    const sweep = () => (gateway as any).sweepSessions();
    await sweep();
    expect(db.session.findMany).not.toHaveBeenCalled(); // nobody to check
    // s2 is the same login's second tab
    const tokens: Record<string, string> = { s1: 'live', s2: 'live', s3: 'revoked', s4: 'deactivated' };
    const dashboards = Object.entries(tokens).map(([id, token]) => socket(id, { token }));
    for (const s of dashboards) await gateway.handleConnection(s);
    db.apiKey.findUnique.mockResolvedValue({ expiresAt: null, permissions: [], user: { id: 'u1', organizationId: 'o1', isActive: true } });
    const integration = socket('s5', { apiKey: 'k' });
    await gateway.handleConnection(integration);
    db.session.findMany.mockResolvedValue([{ tokenHash: hash('live') }]);
    await sweep();
    expect(db.session.findMany.mock.calls).toEqual([[{
      where: { tokenHash: { in: [hash('live'), hash('revoked'), hash('deactivated')] }, expiresAt: { gt: expect.any(Date) }, user: { isActive: true } },
      select: { tokenHash: true },
    }]]);
    expect(Object.fromEntries([...dashboards, integration].map((s) => [s.id, s.disconnect.mock.calls]))).toEqual({
      s1: [], s2: [], s3: [[true]], s4: [[true]], s5: [],
    });
  });

  it('a sweep whose query fails disconnects nobody, and says why on one line', async () => {
    const s = socket('s1', { token: 'live' });
    await gateway.handleConnection(s);
    db.session.findMany.mockRejectedValue(new Error('connection refused\nforged line'));
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    await expect((gateway as any).sweepSessions()).resolves.toBeUndefined();
    expect(s.disconnect).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection refusedforged line'));
  });

  it('sweeps once a minute from module init to module destroy, on a timer that does not hold the process open', async () => {
    vi.useFakeTimers();
    const sweep = vi.spyOn(gateway as any, 'sweepSessions').mockResolvedValue(undefined);
    gateway.onModuleInit();
    expect((gateway as any).sweepTimer.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    gateway.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});

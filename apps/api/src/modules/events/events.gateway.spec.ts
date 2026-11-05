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
  ({ id: 's1', handshake: { auth: { token: 't' } }, data: {}, connected: true, join: vi.fn(), disconnect: vi.fn(), conn: { close: vi.fn() } }) as any;

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
      conn: { close: vi.fn() }, // the transport: closing it, the client reconnects by itself
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
  // socket.io's room operator: `in(room)` (less `.except(other)`) selects sockets, and disconnectSockets closes them
  const inRoom = (room: string, except?: string): any => ({
    except: (other: string) => inRoom(room, other),
    disconnectSockets: (close?: boolean) => {
      for (const id of rooms.get(room) ?? []) if (!except || !rooms.get(except)?.has(id)) sockets.get(id)?.disconnect(close);
    },
  });
  /** The ids, of these sockets, that were disconnected. */
  const closed = (...list: any[]) => list.filter((s) => s.disconnect.mock.calls.length).map((s) => s.id);

  beforeEach(() => {
    rooms.clear();
    sockets.clear();
    emitted.mockReset();
    bus = { emit: vi.fn() };
    verify = vi.fn().mockResolvedValue({ sub: 'u1' });
    gateway = new EventsGateway({ verifyAsync: verify } as any, bus as any);
    gateway.server = { adapter: { rooms }, sockets, to: vi.fn(() => ({ emit: emitted })), in: inRoom } as any;
    db.user.findUnique.mockReset().mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: true });
    db.apiKey.findUnique.mockReset().mockResolvedValue(null);
    db.session.findUnique.mockReset().mockResolvedValue(liveSession());
    db.session.findMany.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks(); // Math.random
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

  it('an API-key socket carries its key\'s id and scopes, never the key; a JWT socket neither', async () => {
    db.apiKey.findUnique.mockResolvedValue({ id: 'k2', expiresAt: null, permissions: ['messages:read'], user: { id: 'u2', organizationId: 'o1', isActive: true } });
    const principal = await gateway.authOf(socket('s3', { apiKey: 'mwa_the-raw-key' }));
    expect(principal).toEqual({ userId: 'u2', organizationId: 'o1', apiKeyScopes: ['messages:read'], apiKeyId: 'k2' });
    expect(JSON.stringify(principal)).not.toContain('mwa_the-raw-key');
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

  it.each([
    ['user', { token: 't' }],
    ['session', { token: 't' }],
    ['apiKey', { apiKey: 'k' }],
  ])("a socket whose %s lookup throws (the database is down) is closed, not refused, so it reconnects by itself; nothing rejects", async (table, auth) => {
    vi.useFakeTimers();
    db[table].findUnique.mockRejectedValue(new Error('connection refused'));
    const s = socket('s7', auth);
    await expect(gateway.authOf(s)).resolves.toBeNull();
    await expect(gateway.handleConnection(s)).resolves.toBeUndefined();
    expect(s.join).not.toHaveBeenCalled();
    // Not Forbidden, which a client may take as final: it is to join again once it has reconnected.
    await expect(gateway.handleJoin(s, { profileId: 'p1' })).resolves.toEqual({ success: false, error: 'Unavailable' });
    await expect(gateway.handleSubscribeProfile(s, { profileId: 'p1' })).resolves.toEqual({ success: false, error: 'Unavailable' });
    expect(s.join).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.conn.close).toHaveBeenCalledTimes(1);
    expect(s.disconnect).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalled();
  });

  // socket.io-client resets its reconnect backoff whenever a connection opens: one closed at once would be back in
  // about a second, every tab and integration, for as long as the database is down.
  it('a socket whose credentials could not be checked is not closed at once: it is held 5 to 15 s, jittered, and never refused', async () => {
    vi.useFakeTimers();
    db.user.findUnique.mockRejectedValue(new Error('connection refused'));
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.9999);
    const [soonest, latest] = [socket('s1'), socket('s2')];
    await gateway.handleConnection(soonest);
    await gateway.handleConnection(latest);
    const closes = () => [soonest, latest].map((s) => s.conn.close.mock.calls.length);
    expect(closes()).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(closes()).toEqual([0, 0]);
    await vi.advanceTimersByTimeAsync(1); // 5 s
    expect(closes()).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(9_999); // just under 15 s
    expect(closes()).toEqual([1, 1]);
    expect([soonest, latest].map((s) => s.disconnect.mock.calls.length)).toEqual([0, 0]);
  });

  // Real timers: a spy set on a fake setTimeout would put that fake back when the mocks are restored.
  it('the hold does not keep the process open', async () => {
    db.user.findUnique.mockRejectedValue(new Error('connection refused'));
    vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    await gateway.handleConnection(socket('s1'));
    const hold: NodeJS.Timeout = timers.mock.results[timers.mock.calls.findIndex(([, ms]) => ms !== undefined && ms < 60_000)].value; // not the quiet minute
    clearTimeout(hold);
    gateway.onModuleDestroy();
    expect(hold.hasRef()).toBe(false);
  });

  it('a socket whose credentials could not be checked and that has left meanwhile is not closed', async () => {
    vi.useFakeTimers();
    db.user.findUnique.mockRejectedValue(new Error('connection refused'));
    const s = socket('s1');
    await gateway.handleConnection(s);
    leave(s);
    gateway.handleDisconnect(s);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.conn.close).not.toHaveBeenCalled();
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  // While the database is down every socket is unchecked, and each comes back every few seconds.
  it('the first socket whose credentials could not be checked is warned at once, its error on one line; alone, it makes no other warning', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    db.user.findUnique.mockRejectedValueOnce(new Error('connection refused\nforged line'));
    await gateway.handleConnection(socket('s1'));
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/s1.*: connection refusedforged line$/)]]);
    expect((gateway as any).unchecked.quiet.hasRef()).toBe(false); // the quiet minute does not hold the process open
    await vi.advanceTimersByTimeAsync(180_000);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('more within the minute after that warning are only counted, with no line of their own, and make one warning at its end: their count and the latest error', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    // Nest's default logger prints debug lines in production too: one per socket would flood the log in an outage.
    const debug = vi.spyOn((gateway as any).logger, 'debug').mockImplementation(() => undefined);
    db.user.findUnique
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new Error('timed out\nforged line'));
    await gateway.handleConnection(socket('s1'));
    await vi.advanceTimersByTimeAsync(30_000);
    await gateway.handleConnection(socket('s2'));
    await vi.advanceTimersByTimeAsync(29_000);
    await gateway.handleConnection(socket('s3'));
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/s1.*: connection refused$/)]]);
    await vi.advanceTimersByTimeAsync(1_000); // a minute after the first
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/ 2 more socket\(s\) .*: timed outforged line$/));
    expect(debug).not.toHaveBeenCalled();
  });

  it('that warning starts the next quiet minute; a socket after a minute with none is warned at once again', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    db.user.findUnique.mockRejectedValue(new Error('connection refused'));
    await gateway.handleConnection(socket('s1')); // warned at once
    await vi.advanceTimersByTimeAsync(30_000);
    await gateway.handleConnection(socket('s2')); // counted
    await vi.advanceTimersByTimeAsync(31_000); // 61 s: s2 was counted in a warning at 60 s
    expect(warn).toHaveBeenCalledTimes(2);
    await gateway.handleConnection(socket('s3')); // within the minute that warning started: only counted
    expect(warn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_000); // 120 s
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/ 1 more socket\(s\) .*: connection refused$/));
    await vi.advanceTimersByTimeAsync(61_000); // 181 s, two minutes after s3: the minute from 120 s counted none
    expect(warn).toHaveBeenCalledTimes(3);
    await gateway.handleConnection(socket('s4'));
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/s4.*: connection refused$/));
  });

  it('a socket closed because its credentials could not be checked leaves no line when it goes (each is back every few seconds); any other socket does', async () => {
    vi.useFakeTimers();
    vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn((gateway as any).logger, 'log').mockImplementation(() => undefined);
    db.user.findUnique.mockRejectedValueOnce(new Error('connection refused'));
    const held = socket('s1');
    await gateway.handleConnection(held);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(held.conn.close).toHaveBeenCalledTimes(1);
    leave(held);
    gateway.handleDisconnect(held);
    const checked = socket('s2');
    await gateway.handleConnection(checked);
    leave(checked);
    gateway.handleDisconnect(checked);
    expect(log).not.toHaveBeenCalledWith('Client disconnected: s1');
    expect(log).toHaveBeenCalledWith('Client disconnected: s2');
  });

  it('bad credentials are still refused, never closed for a retry: an invalid JWT, an inactive user, a missing or expired session', async () => {
    const refusals = [
      () => verify.mockRejectedValueOnce(new Error('jwt expired')),
      () => db.user.findUnique.mockResolvedValueOnce({ id: 'u1', organizationId: 'o1', isActive: false }),
      () => db.session.findUnique.mockResolvedValueOnce(null),
      () => db.session.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1_000) }),
    ];
    for (const [i, refuse] of refusals.entries()) {
      refuse();
      const s = socket(`s2${i}`);
      await gateway.handleConnection(s);
      expect(s.disconnect).toHaveBeenCalledWith(true);
      expect(s.conn.close).not.toHaveBeenCalled();
      expect(s.join).not.toHaveBeenCalled();
      expect(await gateway.handleJoin(s, { profileId: 'p1' })).toEqual({ success: false, error: 'Forbidden' });
    }
  });

  it("an API-key socket (an integration) joins no user room and keeps no one online; the same user's dashboard login does", async () => {
    db.apiKey.findUnique.mockResolvedValue({ expiresAt: null, permissions: [], user: { id: 'u1', organizationId: 'o1', isActive: true } });
    const integration = socket('s5', { apiKey: 'k' });
    await gateway.handleConnection(integration);
    expect(integration.join).not.toHaveBeenCalledWith('user:u1');
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
    db.apiKey.findUnique.mockResolvedValue({ id: 'k9', expiresAt: null, permissions: null, user: { id: 'u1', organizationId: 'o1', isActive: true } });
    const s = socket('s9', { apiKey: 'k' });
    expect(await gateway.authOf(s)).toEqual({ userId: 'u1', organizationId: 'o1', apiKeyScopes: [], apiKeyId: 'k9' });
    await gateway.handleConnection(s);
    expect(s.join).not.toHaveBeenCalledWith('user:u1');
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

  describe('a revoked credential closes its sockets at once', () => {
    const U1 = { id: 'u1', organizationId: 'o1', isActive: true };
    const U2 = { id: 'u2', organizationId: 'o1', isActive: true };
    // The raw API keys of these fixtures, as a handshake sends them.
    const KEYS: Record<string, { id: string; user: typeof U1 }> = { 'key-a': { id: 'k1', user: U1 }, 'key-b': { id: 'k2', user: U1 }, 'key-c': { id: 'k3', user: U2 } };

    beforeEach(() => {
      // A token reads `<user>-<login>`: a user's two logins are two sessions.
      verify.mockImplementation(async (token: string) => ({ sub: token.split('-')[0] }));
      db.user.findUnique.mockImplementation(async ({ where }: any) => ({ u1: U1, u2: U2 })[where.id as 'u1' | 'u2'] ?? null);
      db.apiKey.findUnique.mockImplementation(async ({ where }: any) => {
        const key = Object.entries(KEYS).find(([raw]) => hash(raw) === where.keyHash)?.[1];
        return key ? { id: key.id, expiresAt: null, permissions: [], user: key.user } : null;
      });
    });
    const dashboard = async (id: string, token: string) => {
      const s = socket(id, { token });
      await gateway.handleConnection(s);
      return s;
    };
    const integration = async (id: string, apiKey: string) => {
      const s = socket(id, { apiKey });
      await gateway.handleConnection(s);
      return s;
    };

    it("every socket joins its user's room for revocation; a dashboard socket also its session's, an API-key socket also its key's", async () => {
      await dashboard('d1', 'u1-a');
      await dashboard('d2', 'u1-b');
      await integration('i1', 'key-a');
      expect(rooms.get('principal:u1')).toEqual(new Set(['d1', 'd2', 'i1']));
      expect(rooms.get(`session:${hash('u1-a')}`)).toEqual(new Set(['d1']));
      expect(rooms.get(`session:${hash('u1-b')}`)).toEqual(new Set(['d2']));
      expect(rooms.get('apikey:k1')).toEqual(new Set(['i1']));
      // presence is the dashboard's alone: the API-key socket is in no `user:` room
      expect(rooms.get('user:u1')).toEqual(new Set(['d1', 'd2']));
    });

    it("a deleted API key's sockets are closed, and no other socket", async () => {
      const [a1, a2, b, c, login] = [await integration('a1', 'key-a'), await integration('a2', 'key-a'), await integration('b', 'key-b'), await integration('c', 'key-c'), await dashboard('d', 'u1-a')];
      gateway.disconnectApiKey('k1');
      expect(closed(a1, a2, b, c, login)).toEqual(['a1', 'a2']);
      expect(a1.disconnect).toHaveBeenCalledWith(true);
    });

    it("a removed user's sockets, a login's and an API key's, are closed; another user's are not", async () => {
      const [d1, d2, k1, d3, k3] = [await dashboard('d1', 'u1-a'), await dashboard('d2', 'u1-b'), await integration('k1', 'key-a'), await dashboard('d3', 'u2-a'), await integration('k3', 'key-c')];
      gateway.disconnectUser('u1');
      expect(closed(d1, d2, k1, d3, k3)).toEqual(['d1', 'd2', 'k1']);
      expect(d1.disconnect).toHaveBeenCalledWith(true);
    });

    it("a logged-out or revoked session's sockets are closed, every tab of it; the user's other session and API key keep theirs", async () => {
      const [tab1, tab2, other, key] = [await dashboard('t1', 'u1-a'), await dashboard('t2', 'u1-a'), await dashboard('o', 'u1-b'), await integration('k', 'key-a')];
      gateway.disconnectSession(hash('u1-a'));
      expect(closed(tab1, tab2, other, key)).toEqual(['t1', 't2']);
      expect(tab1.disconnect).toHaveBeenCalledWith(true);
    });

    it("revoking a user's other sessions closes their dashboard sockets but the current session's: no API-key socket, no one else's", async () => {
      const [cur1, cur2, old, key, someone] = [
        await dashboard('c1', 'u1-a'), await dashboard('c2', 'u1-a'), await dashboard('old', 'u1-b'), await integration('k', 'key-a'), await dashboard('x', 'u2-a'),
      ];
      gateway.disconnectOtherSessions('u1', hash('u1-a'));
      expect(closed(cur1, cur2, old, key, someone)).toEqual(['old']);
      expect(old.disconnect).toHaveBeenCalledWith(true);
    });

    it("with no current session, revoking a user's sessions closes every dashboard socket of theirs, and still no API-key socket", async () => {
      const [a, b, key, someone] = [await dashboard('a', 'u1-a'), await dashboard('b', 'u1-b'), await integration('k', 'key-a'), await dashboard('x', 'u2-a')];
      gateway.disconnectOtherSessions('u1');
      expect(closed(a, b, key, someone)).toEqual(['a', 'b']);
    });

    it('each revocation leaves one line with its reason; no token, session hash or key, and no forged line', () => {
      const log = vi.spyOn((gateway as any).logger, 'log').mockImplementation(() => undefined);
      gateway.disconnectApiKey('k1\nforged line');
      gateway.disconnectUser('u1\r\nforged line');
      gateway.disconnectSession(hash('u1-a'));
      gateway.disconnectOtherSessions('u1', hash('u1-a'));
      const lines = log.mock.calls.map(([line]) => line as string);
      expect(lines).toEqual([
        'Disconnecting the sockets of API key k1forged line: the key was deleted',
        'Disconnecting the sockets of user u1forged line: the user was removed',
        'Disconnecting the sockets of a session: it was logged out or revoked',
        "Disconnecting the dashboard sockets of user u1: their other sessions were revoked",
      ]);
      expect(lines.join('\n')).not.toContain(hash('u1-a'));
    });

    it('an adapter that fails never breaks the request that revoked: it warns, on one line, and the sweep is left to close them', () => {
      const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
      (gateway.server as any).in = () => {
        throw new Error('adapter down\nforged line');
      };
      expect(() => gateway.disconnectApiKey('k1')).not.toThrow();
      expect(() => gateway.disconnectUser('u1')).not.toThrow();
      expect(() => gateway.disconnectSession('h')).not.toThrow();
      expect(() => gateway.disconnectOtherSessions('u1')).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(4);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/adapter downforged line$/));
    });
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

  it('module destroy ends a quiet minute too: its warning never comes', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn((gateway as any).logger, 'warn').mockImplementation(() => undefined);
    db.user.findUnique.mockRejectedValue(new Error('connection refused'));
    await gateway.handleConnection(socket('s1')); // warned at once
    await gateway.handleConnection(socket('s2')); // counted, for the warning at the end of the minute
    gateway.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// The four roles through the real app (HTTP → auth guard → role check → Prisma → Postgres): a viewer reads but changes
// nothing, a member does the daily work but no configuration, an admin configures and manages members and viewers,
// only the owner manages admins, and only the server's owner reaches the server settings. Plus the pairing QR on the
// /ws socket, a socket's end with its credential, and the registration gate. The unit specs pin the same rules with
// Prisma mocked.
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '@multiwa/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { EngineManagerService } from '../src/modules/profiles/engine-manager.service';
import { EventsGateway } from '../src/modules/events/events.gateway';

const engineStub = { onModuleInit: () => undefined, onModuleDestroy: () => undefined, getEngine: () => null, getStatus: () => 'DISCONNECTED' };

type Session = { token: string; user: { id: string; organizationId: string } };

const tag = `rl${Date.now()}`;
// Registration and login allow 5 a minute per client IP: each call comes from its own address.
let clientSeq = 0;
const nextAddress = () => `10.78.${Math.floor(++clientSeq / 254) % 254}.${(clientSeq % 254) + 1}`;

describe('Roles (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: Session;
  let admin: Session;
  let member: Session;
  let viewer: Session;
  let profileId: string;
  let origin: string; // where the app listens, for the /ws sockets

  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, auth: { token?: string; apiKey?: string }, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: auth.apiKey ? { 'x-api-key': auth.apiKey } : { authorization: `Bearer ${auth.token}` },
      ...(payload ? { payload } : {}),
    });

  /** A socket on /ws with a JWT or an API key, connected; `got` lists every event it is sent, in order. */
  const connectSocket = (credential: string | { apiKey: string }) =>
    new Promise<{ socket: Socket; got: string[] }>((resolve, reject) => {
      const auth = typeof credential === 'string' ? { token: credential } : credential;
      const socket = io(`${origin}/ws`, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
      const got: string[] = [];
      socket.onAny((event: string) => got.push(event));
      socket.once('connect', () => resolve({ socket, got }));
      socket.once('connect_error', (e) => {
        socket.close();
        reject(e);
      });
    });

  async function session(url: string, payload: object): Promise<Session> {
    const res = await app.inject({ method: 'POST', url: `/api/v1${url}`, remoteAddress: nextAddress(), payload });
    const body = res.json();
    if (typeof body?.accessToken !== 'string') throw new Error(`${url} failed: ${res.statusCode} — ${res.body}`);
    return { token: body.accessToken, user: body.user };
  }
  const register = (who: string) =>
    session('/auth/register', { email: `${tag}-${who}@test.local`, password: 'password1234!', name: who, organizationName: `${tag}-${who}` });
  async function addAndSignIn(role: string): Promise<Session> {
    const added = await send('POST', '/organizations/members', owner, { email: `${tag}-${role}@test.local`, name: role, role });
    expect(added.statusCode).toBe(201);
    return session('/auth/login', { email: `${tag}-${role}@test.local`, password: added.json().temporaryPassword });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EngineManagerService).useValue(engineStub).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1'); // an ephemeral port, for the sockets
    origin = await app.getUrl();

    await register('early'); // so that `owner` below is never the oldest organization's owner, whatever ran before
    owner = await register('owner');
    admin = await addAndSignIn('admin');
    member = await addAndSignIn('member');
    viewer = await addAndSignIn('viewer');
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: owner.user.organizationId } });
    profileId = (await prisma.profile.create({ data: { workspaceId: workspace.id, displayName: `${tag} line` } })).id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a viewer reads, but changes nothing, by login or by their API key', async () => {
    expect((await send('GET', `/conversations?profileId=${profileId}`, viewer)).statusCode).toBe(200);
    expect((await send('POST', '/contacts', viewer, { profileId, phone: '628111000201' })).statusCode).toBe(403);
    expect((await send('POST', '/messages/text', viewer, { profileId, to: '628111000201', text: 'hi' })).statusCode).toBe(403);

    const key = await send('POST', '/api-keys', viewer, { name: `${tag} viewer key` });
    expect(key.statusCode).toBe(201); // every role manages its own keys; a key acts with its user's role
    expect((await send('POST', '/messages/text', { apiKey: key.json().key }, { profileId, to: '628111000201', text: 'hi' })).statusCode).toBe(403);
  });

  it('a member does the daily work, but configures nothing and reads no secrets', async () => {
    expect((await send('POST', '/contacts', member, { profileId, phone: '628111000202' })).statusCode).toBe(201);
    expect((await send('PUT', '/organizations/current', member, { name: `${tag} renamed` })).statusCode).toBe(403);
    expect((await send('GET', `/webhooks?profileId=${profileId}`, member)).statusCode).toBe(403);
    expect((await send('POST', '/webhooks', member, { profileId, url: 'https://example.com/hook', events: ['message.received'] })).statusCode).toBe(403);
  });

  it("a member's send passes the role check", async () => {
    // Not 201: the engine is stubbed, so the profile has no live connection.
    vi.stubEnv('ENGINE_HOST', 'api'); // ENGINE_HOST=worker (CI sets it) and DURABLE_SEND=true queue the send instead, and answer 201
    vi.stubEnv('DURABLE_SEND', 'false');
    try {
      const sent = await send('POST', '/messages/text', member, { profileId, to: '628111000203', text: 'hi' });
      expect(sent.statusCode).toBe(409);
      expect(sent.json()).toMatchObject({ error: 'PROFILE_DISCONNECTED' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('an admin configures, and reads the webhooks', async () => {
    expect((await send('PUT', '/organizations/current', admin, { name: `${tag} renamed` })).statusCode).toBe(200);
    expect((await send('GET', `/webhooks?profileId=${profileId}`, admin)).statusCode).toBe(200);
  });

  it('an admin creates a webhook', async () => {
    expect((await send('POST', '/webhooks', admin, { profileId, url: 'https://example.com/hook', events: ['message.received'] })).statusCode).toBe(201);
  });

  it('an admin manages members and viewers; only the owner manages admins; nobody changes their own role', async () => {
    expect((await send('POST', '/organizations/members', admin, { email: `${tag}-admin2@test.local`, name: 'a2', role: 'admin' })).statusCode).toBe(403);
    expect((await send('PUT', `/organizations/members/${member.user.id}/role`, admin, { role: 'viewer' })).statusCode).toBe(200);
    expect((await send('PUT', `/organizations/members/${member.user.id}/role`, admin, { role: 'admin' })).statusCode).toBe(403);
    expect((await send('PUT', `/organizations/members/${admin.user.id}/role`, admin, { role: 'member' })).statusCode).toBe(400);
    expect((await send('PUT', `/organizations/members/${member.user.id}/role`, owner, { role: 'member' })).statusCode).toBe(200);
  });

  it("only the server's owner reaches the server settings", async () => {
    expect((await send('GET', '/settings/smtp', owner)).statusCode).toBe(403); // owner of a later organization
    expect((await send('GET', '/auth/me', owner)).json().isServerOwner).toBe(false);
  });

  it("a viewer's socket gets no pairing QR, and an owner's does", async () => {
    const [ownerWs, viewerWs] = await Promise.all([connectSocket(owner.token), connectSocket(viewer.token)]);
    try {
      for (const { socket } of [ownerWs, viewerWs]) expect(await socket.emitWithAck('join', { profileId })).toEqual({ success: true, profileId });

      const gateway = app.get(EventsGateway);
      await gateway.emitQrUpdate(profileId, 'data:image/png;base64,iVBORw0KGgo=');
      await vi.waitFor(() => expect(ownerWs.got).toContain('qr:update'), { timeout: 5000 });
      // A socket keeps its events in order: a viewer that has this status has had any QR before it.
      gateway.emitConnectionStatus(profileId, 'connected', '628111000999');
      await vi.waitFor(() => expect(viewerWs.got).toContain('connection:status'), { timeout: 5000 });
      expect(viewerWs.got).toEqual(['connection:status']);
    } finally {
      ownerWs.socket.close();
      viewerWs.socket.close();
    }
  });

  describe('a socket ends with its credential', () => {
    /** A new member of the owner's organization, signed in; `login()` signs them in again, as a second session. */
    async function newMember(label: string) {
      const email = `${tag}-${label}@test.local`;
      const added = await send('POST', '/organizations/members', owner, { email, name: label, role: 'member' });
      expect(added.statusCode).toBe(201);
      const login = () => session('/auth/login', { email, password: added.json().temporaryPassword });
      return { ...(await login()), login };
    }
    /** A new API key of a user: its id, and the key. */
    async function newKey(who: Session) {
      const created = await send('POST', '/api-keys', who, { name: `${tag} key`, expiresInDays: 30 });
      expect(created.statusCode).toBe(201);
      return { id: created.json().id as string, key: created.json().key as string };
    }
    const gone = (socket: Socket) => vi.waitFor(() => expect(socket.connected).toBe(false), { timeout: 3000 });
    const open: Socket[] = [];
    // A socket without valid credentials is accepted and then closed: the join's answer says it is authenticated.
    const connect = async (credential: string | { apiKey: string }) => {
      const { socket } = await connectSocket(credential);
      open.push(socket);
      expect(await socket.emitWithAck('join', { profileId })).toEqual({ success: true, profileId });
      return socket;
    };
    afterEach(() => {
      vi.restoreAllMocks();
      for (const socket of open.splice(0)) socket.close();
    });

    it('deleting an API key, logging out, revoking the other sessions and removing a member close their sockets at once', async () => {
      // Stubbed, so that only the calls that revoke close these sockets, and not the sweep (its minute is far off anyway).
      vi.spyOn(app.get(EventsGateway) as any, 'sweepSockets').mockResolvedValue(undefined);
      const bystander = await connect(owner.token);

      const keyed = await newMember('keyed');
      const key = await newKey(keyed);
      const keySocket = await connect({ apiKey: key.key });
      expect((await send('DELETE', `/api-keys/${key.id}`, keyed)).statusCode).toBe(200);
      await gone(keySocket);

      const loggingOut = await newMember('logout');
      const loginSocket = await connect(loggingOut.token);
      expect((await send('POST', '/auth/logout', loggingOut)).statusCode).toBeLessThan(300);
      await gone(loginSocket);

      // One session, and every session but the current one: the current session's socket, and the user's API key, keep theirs.
      const [single, others] = [await newMember('session'), await newMember('sessions')];
      const firstSockets = [await connect(single.token), await connect(others.token)];
      await new Promise((resolve) => setTimeout(resolve, 1100)); // a token is signed to the second: a second login within it is the same session
      const [singleNow, othersNow] = [await single.login(), await others.login()];
      const currentSockets = [await connect(singleNow.token), await connect(othersNow.token), await connect({ apiKey: (await newKey(others)).key })];
      const firstSession = await prisma.session.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(single.token).digest('hex') } });
      expect((await send('DELETE', `/auth/sessions/${firstSession.id}`, singleNow)).statusCode).toBe(200);
      expect((await send('DELETE', '/auth/sessions', othersNow)).statusCode).toBe(200);
      for (const socket of firstSockets) await gone(socket);
      expect(currentSockets.map((socket) => socket.connected)).toEqual([true, true, true]);

      const removed = await newMember('removed');
      const removedSockets = [await connect(removed.token), await connect({ apiKey: (await newKey(removed)).key })];
      expect((await send('DELETE', `/organizations/members/${removed.user.id}`, owner)).statusCode).toBe(200);
      for (const socket of removedSockets) await gone(socket);

      expect([bystander, ...currentSockets].map((socket) => socket.connected)).toEqual([true, true, true, true]);
    });

    it("the sweep closes the sockets of an API key that expired or was deleted, of a session that is gone, and of a user who is inactive, and keeps the others", async () => {
      const gateway = app.get(EventsGateway) as any;
      const kept = [await connect(owner.token), await connect({ apiKey: (await newKey(owner)).key })];

      // changed in the database, behind the API: only the sweep finds these
      const keys = await newMember('keys');
      const [expiring, deleted] = [await newKey(keys), await newKey(keys)];
      const keySockets = [await connect({ apiKey: expiring.key }), await connect({ apiKey: deleted.key })];
      await prisma.apiKey.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      await prisma.apiKey.delete({ where: { id: deleted.id } });

      const sessions = await newMember('gone');
      const sessionSocket = await connect(sessions.token);
      await prisma.session.deleteMany({ where: { userId: sessions.user.id } });

      const inactive = await newMember('inactive');
      const inactiveSockets = [await connect(inactive.token), await connect({ apiKey: (await newKey(inactive)).key })];
      await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });

      for (const socket of [...kept, ...keySockets, sessionSocket, ...inactiveSockets]) expect(socket.connected).toBe(true); // until the sweep
      await gateway.sweepSockets();
      for (const socket of [...keySockets, sessionSocket, ...inactiveSockets]) await gone(socket);
      expect(kept.map((socket) => socket.connected)).toEqual([true, true]);
    });
  });

  it('registration closes unless ALLOW_REGISTRATION=true', async () => {
    const before = process.env.ALLOW_REGISTRATION;
    process.env.ALLOW_REGISTRATION = 'false';
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })).json()).toEqual({ open: false });
      const refused = await app.inject({
        method: 'POST', url: '/api/v1/auth/register', remoteAddress: nextAddress(),
        payload: { email: `${tag}-late@test.local`, password: 'password1234!', name: 'late', organizationName: `${tag}-late` },
      });
      expect(refused.statusCode).toBe(403);
    } finally {
      // Assigning undefined would store the string "undefined".
      if (before === undefined) delete process.env.ALLOW_REGISTRATION;
      else process.env.ALLOW_REGISTRATION = before;
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })).json()).toEqual({ open: true });
  });
});

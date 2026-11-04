// The four roles through the real app (HTTP → auth guard → role check → Prisma → Postgres): a viewer reads but changes
// nothing, a member does the daily work but no configuration, an admin configures and manages members and viewers,
// only the owner manages admins, and only the server's owner reaches the server settings. Plus the registration gate.
// The unit specs pin the same rules with Prisma mocked.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@multiwa/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { EngineManagerService } from '../src/modules/profiles/engine-manager.service';

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

  const send = (method: 'GET' | 'POST' | 'PUT', url: string, auth: { token?: string; apiKey?: string }, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: auth.apiKey ? { 'x-api-key': auth.apiKey } : { authorization: `Bearer ${auth.token}` },
      ...(payload ? { payload } : {}),
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

  it('an admin configures, and reads the webhooks', async () => {
    expect((await send('PUT', '/organizations/current', admin, { name: `${tag} renamed` })).statusCode).toBe(200);
    expect((await send('GET', `/webhooks?profileId=${profileId}`, admin)).statusCode).toBe(200);
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
      process.env.ALLOW_REGISTRATION = before;
    }
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/registration' })).json()).toEqual({ open: true });
  });
});

// Who may do what around roles, API keys and automation order, through the real app (HTTP → guards → Prisma →
// Postgres), tried as someone inside one organization would try them:
//   - a viewer on the RBAC routes;
//   - an admin reading the members of a role;
//   - an assignment naming another organization's user;
//   - an API key making a wider key;
//   - an order naming another organization's rule.
// The unit specs pin the same rules with Prisma mocked.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@multiwa/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { EngineManagerService } from '../src/modules/profiles/engine-manager.service';

const engineStub = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  getEngine: () => null,
  getStatus: () => 'DISCONNECTED',
};

type Session = { token: string; user: { id: string; organizationId: string } };

const tag = `ab${Date.now()}`;
// Registration and login allow 5 a minute per client IP: each call comes from its own address.
let clientSeq = 0;
const nextAddress = () => `10.77.${Math.floor(++clientSeq / 254) % 254}.${(clientSeq % 254) + 1}`;

describe('Access boundaries (e2e)', () => {
  let app: NestFastifyApplication;
  let owner: Session;
  let viewer: Session;
  let stranger: Session; // the owner of another organization

  const send = (method: 'GET' | 'POST', url: string, auth: { token?: string; apiKey?: string }, payload?: object) =>
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

  async function profileOf(s: Session) {
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: s.user.organizationId } });
    return prisma.profile.create({ data: { workspaceId: workspace.id, displayName: `${tag} line` } });
  }
  const rule = (profileId: string, priority: number) =>
    prisma.automation.create({ data: { profileId, name: `${tag} rule`, priority, triggerType: 'keyword', triggerConfig: { keywords: ['hi'] }, actions: [] } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EngineManagerService)
      .useValue(engineStub)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    owner = await register('owner');
    stranger = await register('stranger');
    const added = await send('POST', '/organizations/members', owner, { email: `${tag}-viewer@test.local`, name: 'viewer', role: 'viewer' });
    expect(added.statusCode).toBe(201);
    viewer = await session('/auth/login', { email: `${tag}-viewer@test.local`, password: added.json().temporaryPassword });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('refuses a viewer on the RBAC routes', async () => {
    expect((await send('POST', '/rbac/roles', viewer, { name: `${tag} mine`, permissions: [] })).statusCode).toBe(403);
    expect((await send('GET', '/rbac/roles', viewer)).statusCode).toBe(403);
  });

  it("gives an owner a role's members as the team list shows them", async () => {
    const role = await send('POST', '/rbac/roles', owner, { name: `${tag} support`, permissions: ['message:read'] });
    expect(role.statusCode).toBe(201);
    const roleId = role.json().id;
    expect((await send('POST', '/rbac/assign', owner, { userId: viewer.user.id, roleId })).statusCode).toBe(201);

    const read = await send('GET', `/rbac/roles/${roleId}`, owner);
    expect(read.statusCode).toBe(200);
    expect(read.json().users.map((u: { user: object }) => Object.keys(u.user).sort())).toEqual([['email', 'id', 'isActive', 'name', 'role']]);
  });

  it("does not find another organization's user to assign, and assigns nothing", async () => {
    const role = await send('POST', '/rbac/roles', owner, { name: `${tag} outsiders`, permissions: [] });
    const res = await send('POST', '/rbac/assign', owner, { userId: stranger.user.id, roleId: role.json().id });
    expect(res.statusCode).toBe(404);
    expect(await prisma.userRole.count({ where: { userId: stranger.user.id } })).toBe(0);
  });

  it('lets a signed-in user create an API key, and refuses that key making another', async () => {
    const created = await send('POST', '/api-keys', owner, { name: `${tag} narrow`, permissions: ['messages:read'] });
    expect(created.statusCode).toBe(201);
    const wider = await send('POST', '/api-keys', { apiKey: created.json().key }, { name: `${tag} wider`, permissions: [] });
    expect(wider.statusCode).toBe(403);
    expect(await prisma.apiKey.count({ where: { userId: owner.user.id } })).toBe(1);
  });

  it("refuses an order naming another organization's rule, changes no priority, and still orders the profile's own", async () => {
    const mine = await rule((await profileOf(owner)).id, 5);
    const theirs = await rule((await profileOf(stranger)).id, 7);

    const refused = await send('POST', '/automation/reorder', owner, { profileId: mine.profileId, order: [mine.id, theirs.id] });
    expect(refused.statusCode).toBe(404);
    const priorities = await prisma.automation.findMany({ where: { id: { in: [mine.id, theirs.id] } }, select: { id: true, priority: true } });
    expect(Object.fromEntries(priorities.map((a) => [a.id, a.priority]))).toEqual({ [mine.id]: 5, [theirs.id]: 7 });

    expect((await send('POST', '/automation/reorder', owner, { profileId: mine.profileId, order: [mine.id] })).statusCode).toBe(201);
    expect((await prisma.automation.findUniqueOrThrow({ where: { id: mine.id } })).priority).toBe(1);
  });
});

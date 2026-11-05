// The customer profile through the real app (HTTP → auth guard → role and scope checks → service → Postgres), with a
// fake lookup endpoint on this machine. It covers:
// - who may read and change what;
// - a number linked to an ID once (201, then 200), and the number's default ID;
// - notes and their authors;
// - the lookup's four states, the preview of a typed ID (an agent's, at most 30 a minute per actor), and the settings'
//   write-only secret;
// - the search (its % _ and \ are the text typed), the history and the GDPR export;
// - settings saved at the same moment all staying;
// - another organization's customers answering 404.
// The unit specs pin the same rules with Prisma mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { prisma } from '@multiwa/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { decrypt } from '../src/common/crypto/secret-box';
import { EngineManagerService } from '../src/modules/profiles/engine-manager.service';

const engineStub = { onModuleInit: () => undefined, onModuleDestroy: () => undefined, getEngine: () => null, getStatus: () => 'DISCONNECTED' };

type Session = { token: string; user: { id: string; organizationId: string } };
type Auth = { token?: string; apiKey?: string };
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const tag = `cu${Date.now()}`;
// Every request comes from its own address: registration and login allow 5 a minute per address, and every route 120.
let clientSeq = 0;
const nextAddress = () => `10.79.${Math.floor(++clientSeq / 254) % 254}.${(clientSeq % 254) + 1}`;

const PHONE = '6281100000001';
const SECRET = 'lookup-secret-e2e';
const FOUND = {
  id: 'CUST-OK',
  name: 'Budi Santoso',
  fields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }],
  sections: [{ title: 'Tagihan', rows: [{ label: 'Okt 2026', value: 'Rp 245.000 (lunas)' }] }],
};

describe('Customers (e2e)', () => {
  let app: NestFastifyApplication;
  let lookupServer: Server | undefined;
  let lookupUrl: string;
  const lookupAuth: Array<string | undefined> = []; // the Authorization header of each lookup the endpoint got
  let owner: Session;
  let admin: Session;
  let member: Session;
  let viewer: Session;
  let stranger: Session; // the owner of another organization
  let profileId: string;

  const send = (method: Method, url: string, auth: Auth, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      remoteAddress: nextAddress(),
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
  async function addAndSignIn(role: string, name = role): Promise<Session> {
    const email = `${tag}-${name}@test.local`;
    const added = await send('POST', '/organizations/members', owner, { email, name, role });
    expect(added.statusCode).toBe(201);
    return session('/auth/login', { email, password: added.json().temporaryPassword });
  }
  const customerId = async (externalId: string) =>
    (await prisma.customer.findUniqueOrThrow({ where: { organizationId_externalId: { organizationId: owner.user.organizationId, externalId } } })).id;
  const externalIds = (items: Array<{ externalId: string }>) => items.map((c) => c.externalId);

  beforeAll(async () => {
    // The fake lookup endpoint: CUST-OK is found, CUST-NONE is not, anything else fails. It listens on [::1]: with
    // private targets allowed, the SSRF rule sends 127.0.0.1 and localhost to host.docker.internal.
    const server = createServer((req, res) => {
      lookupAuth.push(req.headers.authorization);
      const id = new URL(req.url ?? '/', 'http://lookup.test').searchParams.get('id');
      if (id === 'CUST-OK') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FOUND));
      } else {
        res.writeHead(id === 'CUST-NONE' ? 404 : 500);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
    lookupServer = server;
    lookupUrl = `http://[::1]:${(server.address() as AddressInfo).port}/lookup`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EngineManagerService).useValue(engineStub).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    owner = await register('owner');
    admin = await addAndSignIn('admin');
    member = await addAndSignIn('member');
    viewer = await addAndSignIn('viewer');
    stranger = await register('stranger');
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: owner.user.organizationId } });
    profileId = (await prisma.profile.create({ data: { workspaceId: workspace.id, displayName: `${tag} line` } })).id;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await app?.close();
    const server = lookupServer;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('a viewer reads, but links nothing', async () => {
    expect((await send('GET', '/customers', viewer)).json()).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect((await send('GET', '/customers/config', viewer)).json()).toEqual({ idLabel: 'Customer ID', lookupUrl: null, hasSecret: false, timeoutMs: 5000, configured: false });
    expect((await send('POST', '/customers/links', viewer, { externalId: 'CUST-OK', phone: PHONE })).statusCode).toBe(403);
  });

  it('a member links an ID to a number once: 201, then 200 with the same link', async () => {
    const first = await send('POST', '/customers/links', member, { externalId: 'CUST-OK', phone: '0811-0000-0001' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      created: true,
      customer: { externalId: 'CUST-OK', links: [{ phone: PHONE }] },
      link: { phone: PHONE, linkedBy: { type: 'user', id: member.user.id, name: 'member' } },
    });
    const again = await send('POST', '/customers/links', member, { externalId: 'CUST-OK', phone: `${PHONE}@c.us` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false, link: { id: first.json().link.id } });
    expect((await send('POST', '/customers/links', member, { externalId: 'not valid!', phone: PHONE })).json()).toEqual({
      statusCode: 400, message: 'Invalid customer ID', error: 'Bad Request',
    });
    expect((await send('POST', '/customers/links', member, { externalId: 'CUST-OK', phone: '120363000000000001@g.us' })).json()).toEqual({
      statusCode: 400, message: 'Invalid phone number', error: 'Bad Request',
    });
  });

  it("an API key with customers:read only reads, but may not link; a full key's link names the key", async () => {
    const readOnly = (await send('POST', '/api-keys', member, { name: `${tag} read`, permissions: ['customers:read'] })).json();
    expect((await send('GET', `/customers/by-phone/${PHONE}`, { apiKey: readOnly.key })).statusCode).toBe(200);
    const refused = await send('POST', '/customers/links', { apiKey: readOnly.key }, { externalId: 'CUST-KEY', phone: PHONE });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toContain('customers:write');

    const full = (await send('POST', '/api-keys', member, { name: `${tag} full`, permissions: ['customers:read', 'customers:write'] })).json();
    const linked = await send('POST', '/customers/links', { apiKey: full.key }, { externalId: 'CUST-KEY', phone: PHONE });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().link.linkedBy).toEqual({ type: 'apiKey', id: full.id, name: `${tag} full` });
  });

  it("a number's default ID is the link it used last", async () => {
    const before = (await send('GET', `/customers/by-phone/${PHONE}`, viewer)).json();
    expect(externalIds(before)).toEqual(['CUST-KEY', 'CUST-OK']);
    const older = before[1].linkId;
    expect((await send('POST', `/customers/links/${older}/use`, viewer)).statusCode).toBe(403);
    const used = await send('POST', `/customers/links/${older}/use`, member);
    expect(used.statusCode).toBe(201);
    expect(used.json()).toMatchObject({ id: older, phone: PHONE });
    expect(externalIds((await send('GET', `/customers/by-phone/${PHONE}`, viewer)).json())).toEqual(['CUST-OK', 'CUST-KEY']);
  });

  it("a member writes notes and edits their own; an admin edits anyone's; a viewer writes none", async () => {
    const id = await customerId('CUST-OK');
    const mine = await send('POST', `/customers/${id}/notes`, member, { body: '  Prefers a call after 16:00  ' });
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toMatchObject({ body: 'Prefers a call after 16:00', author: { type: 'user', id: member.user.id, name: 'member' } });
    const theirs = (await send('POST', `/customers/${id}/notes`, admin, { body: 'Meter checked' })).json();
    expect((await send('PATCH', `/customers/${id}/notes/${mine.json().id}`, member, { body: 'Prefers a call after 17:00' })).statusCode).toBe(200);
    expect((await send('PATCH', `/customers/${id}/notes/${theirs.id}`, member, { body: 'changed' })).statusCode).toBe(403);
    expect((await send('DELETE', `/customers/${id}/notes/${theirs.id}`, member)).statusCode).toBe(403);
    expect((await send('PATCH', `/customers/${id}/notes/${mine.json().id}`, admin, { body: 'Prefers a call after 18:00' })).statusCode).toBe(200);
    expect((await send('POST', `/customers/${id}/notes`, viewer, { body: 'hello' })).statusCode).toBe(403);
    expect((await send('GET', `/customers/${id}/notes`, viewer)).json()).toMatchObject({
      total: 2,
      items: [{ body: 'Meter checked' }, { body: 'Prefers a call after 18:00' }],
    });
  });

  it('without a lookup, the lookup is not_configured, and the name and fields are typed by hand', async () => {
    const id = await customerId('CUST-OK');
    expect((await send('GET', `/customers/${id}/lookup`, viewer)).json()).toMatchObject({ state: 'not_configured', data: null, cached: false });
    const typed = await send('PATCH', `/customers/${id}`, member, {
      displayName: 'Budi', manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }], tags: [' vip ', 'vip', 'prepaid'],
    });
    expect(typed.statusCode).toBe(200);
    expect(typed.json()).toMatchObject({ displayName: 'Budi', manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }], tags: ['vip', 'prepaid'] });
  });

  it("an admin's lookup URL passes the webhooks' SSRF rule, and its secret is write-only", async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'false');
    expect((await send('PUT', '/customers/config', admin, { lookupUrl, secret: SECRET })).json()).toEqual({
      statusCode: 400, message: 'Webhook target address is not allowed', error: 'Bad Request',
    });
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'true');
    expect((await send('PUT', '/customers/config', member, { lookupUrl })).statusCode).toBe(403);

    const saved = await send('PUT', '/customers/config', admin, { idLabel: 'ID Pelanggan', lookupUrl, secret: SECRET, timeoutMs: 3000 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ idLabel: 'ID Pelanggan', lookupUrl, hasSecret: true, timeoutMs: 3000, configured: true });
    for (const res of [saved, await send('GET', '/customers/config', viewer), await send('GET', '/organizations/current', viewer)]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(SECRET);
      expect(res.body).not.toContain('lookupSecretEnc');
    }

    const tested = await send('POST', '/customers/config/test', admin, { externalId: 'CUST-OK' });
    expect(tested.statusCode).toBe(201);
    expect(tested.json()).toMatchObject({ state: 'ok', data: { name: 'Budi Santoso' }, cached: false, latencyMs: expect.any(Number) });
    expect(lookupAuth.at(-1)).toBe(`Bearer ${SECRET}`);
    expect((await send('POST', '/customers/config/test', member, { externalId: 'CUST-OK' })).statusCode).toBe(403);
  });

  it("a viewer's /auth/me carries the organization's settings, but never the lookup's stored secret", async () => {
    const row = await prisma.organization.findUniqueOrThrow({ where: { id: owner.user.organizationId } });
    const stored = (row.settings as { customers: { lookupSecretEnc: string } }).customers.lookupSecretEnc;
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/); // the secret is in the row, encrypted
    const me = await send('GET', '/auth/me', viewer);
    expect(me.statusCode).toBe(200);
    expect(me.body).not.toContain('lookupSecretEnc');
    expect(me.body).not.toContain(stored);
    expect(me.body).not.toContain(SECRET);
    expect(me.json().organization.settings.customers).toEqual({ idLabel: 'ID Pelanggan', lookupUrl, timeoutMs: 3000 });
  });

  it('the lookup comes through found, not found and unavailable; a found customer keeps its name', async () => {
    const id = await customerId('CUST-OK');
    expect((await send('GET', `/customers/${id}/lookup`, viewer)).json()).toMatchObject({ state: 'ok', cached: false, data: FOUND });
    expect((await send('GET', `/customers/${id}/lookup`, viewer)).json()).toMatchObject({ state: 'ok', cached: true });
    expect((await send('GET', `/customers/${id}`, viewer)).json()).toMatchObject({ displayName: 'Budi Santoso', lastLookupAt: expect.any(String) });
    expect((await send('GET', '/customers/lookup?externalId=CUST-NONE', member)).json()).toMatchObject({ state: 'not_found', data: null });
    expect((await send('GET', '/customers/lookup?externalId=CUST-DOWN', member)).json()).toMatchObject({ state: 'unavailable', data: null });
    expect(await prisma.customer.count({ where: { organizationId: owner.user.organizationId, externalId: { in: ['CUST-NONE', 'CUST-DOWN'] } } })).toBe(0);
    expect(lookupAuth.every((auth) => auth === `Bearer ${SECRET}`)).toBe(true);
  });

  it("the preview of an ID is an agent's, at most 30 a minute per user or API key: a viewer gets 403, a member's 31st gets 429", async () => {
    const preview = (auth: Auth) => send('GET', '/customers/lookup?externalId=CUST-NONE', auth);
    expect((await preview(viewer)).statusCode).toBe(403);
    // A member with no preview made yet, so that the minute's count starts at 0. The first asks the endpoint and the other
    // 29 are the cache's; all 30 count.
    const sam = await addAndSignIn('member', 'sam');
    for (let i = 1; i <= 30; i++) expect([i, (await preview(sam)).statusCode]).toEqual([i, 200]);
    const refused = await preview(sam);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ statusCode: 429, message: 'Too many lookups, try again shortly', error: 'Too Many Requests' });
    // A key is an actor of its own: sam's new key is not counted with sam, who is refused.
    const key = (await send('POST', '/api-keys', sam, { name: `${tag} preview`, permissions: ['customers:read'] })).json();
    expect((await preview({ apiKey: key.key })).statusCode).toBe(200);
  });

  it('while a lookup is configured, the name and fields are refused with 409; the tags are not', async () => {
    const id = await customerId('CUST-OK');
    expect((await send('PATCH', `/customers/${id}`, member, { displayName: 'Someone else' })).statusCode).toBe(409);
    expect((await send('PATCH', `/customers/${id}`, member, { manualFields: [] })).statusCode).toBe(409);
    expect((await send('PATCH', `/customers/${id}`, member, { tags: ['vip'] })).json()).toMatchObject({ tags: ['vip'], displayName: 'Budi Santoso' });
  });

  it('finds a customer by ID prefix, by name and by number', async () => {
    const found = async (q: string) => externalIds((await send('GET', `/customers?q=${encodeURIComponent(q)}`, viewer)).json().items).sort();
    expect(await found('cust-o')).toEqual(['CUST-OK']);
    expect(await found('budi')).toEqual(['CUST-OK']);
    expect(await found('0811-0000-0001')).toEqual(['CUST-KEY', 'CUST-OK']);
    expect(await found('0001')).toEqual(['CUST-KEY', 'CUST-OK']); // the end of 6281100000001: a 0 at the start is not always a 62
    expect(await found('6281199')).toEqual([]);
    const page = (await send('GET', '/customers?q=budi', viewer)).json();
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25, items: [{ displayName: 'Budi Santoso', linkCount: 1, noteCount: 2, lastActivityAt: expect.any(String) }] });
  });

  it("the history lists the organization's one-to-one chats and calls with the linked numbers, newest first", async () => {
    const id = await customerId('CUST-OK');
    const jid = `${PHONE}@s.whatsapp.net`;
    const chat = await prisma.conversation.create({ data: { profileId, jid, type: 'user', lastMessageAt: new Date('2026-11-01T10:00:00Z') } });
    await prisma.message.create({
      data: { profileId, conversationId: chat.id, messageId: `${tag}-m1`, direction: 'incoming', senderJid: jid, type: 'text', content: { text: 'Halo' }, timestamp: new Date('2026-11-01T10:00:00Z') },
    });
    const call = await prisma.call.create({ data: { profileId, waCallId: `${tag}-call`, fromJid: jid, outcome: 'missed', startedAt: new Date('2026-11-02T09:00:00Z') } });
    // The same number on another organization's line is not this organization's history.
    const theirWorkspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: stranger.user.organizationId } });
    const theirLine = await prisma.profile.create({ data: { workspaceId: theirWorkspace.id, displayName: `${tag} their line` } });
    await prisma.conversation.create({ data: { profileId: theirLine.id, jid, type: 'user', lastMessageAt: new Date('2026-11-03T10:00:00Z') } });

    expect((await send('GET', `/customers/${id}/history`, viewer)).json()).toEqual([
      { kind: 'call', id: call.id, profileId, profileName: `${tag} line`, phone: PHONE, at: '2026-11-02T09:00:00.000Z', summary: 'Voice call, missed' },
      { kind: 'conversation', id: chat.id, profileId, profileName: `${tag} line`, phone: PHONE, at: '2026-11-01T10:00:00.000Z', summary: '1 message' },
    ]);
  });

  it("another organization's customer, link and note answer 404", async () => {
    const id = await customerId('CUST-OK');
    const { links, notes } = (await send('GET', `/customers/${id}`, viewer)).json();
    const tries: Array<[Method, string, object?]> = [
      ['GET', `/customers/${id}`],
      ['GET', `/customers/${id}/lookup`],
      ['GET', `/customers/${id}/history`],
      ['GET', `/customers/${id}/notes`],
      ['PATCH', `/customers/${id}`, { tags: [] }],
      ['DELETE', `/customers/${id}`],
      ['POST', `/customers/${id}/notes`, { body: 'x' }],
      ['PATCH', `/customers/${id}/notes/${notes[0].id}`, { body: 'x' }],
      ['DELETE', `/customers/${id}/notes/${notes[0].id}`],
      ['POST', `/customers/links/${links[0].id}/use`],
      ['DELETE', `/customers/links/${links[0].id}`],
    ];
    for (const [method, url, payload] of tries) {
      expect([method, url, (await send(method, url, stranger, payload)).statusCode]).toEqual([method, url, 404]);
    }
    expect((await send('GET', `/customers/by-phone/${PHONE}`, stranger)).json()).toEqual([]);
    expect((await send('GET', '/customers?q=CUST', stranger)).json()).toMatchObject({ items: [], total: 0 });
    expect((await send('GET', `/customers/${id}`, viewer)).json()).toMatchObject({ tags: ['vip'], notes: [{}, {}] });
  });

  it("an admin deletes a customer with its links and notes; the organization's export carries its customers", async () => {
    const exported = (await send('GET', '/account/export', admin)).json();
    expect(externalIds(exported.customers).sort()).toEqual(['CUST-KEY', 'CUST-OK']);
    expect(exported.statistics.totalCustomers).toBe(2);
    const id = await customerId('CUST-KEY');
    expect((await send('DELETE', `/customers/${id}`, member)).statusCode).toBe(403);
    expect((await send('DELETE', `/customers/${id}`, admin)).json()).toEqual({ success: true });
    expect(await prisma.customerLink.count({ where: { customerId: id } })).toBe(0);
    expect((await send('GET', `/customers/${id}`, admin)).statusCode).toBe(404);
  });

  it('a search finds the % _ and \\ typed, not a wildcard: A_ is not A1 or AB', async () => {
    const organizationId = owner.user.organizationId;
    const ids = ['A1', 'AB', 'A_C'];
    for (const externalId of ids) expect((await send('POST', '/customers/links', member, { externalId, phone: PHONE })).statusCode).toBe(201);
    await prisma.customer.update({ where: { organizationId_externalId: { organizationId, externalId: 'AB' } }, data: { displayName: '100% sure' } });
    const found = async (q: string) => externalIds((await send('GET', `/customers?q=${encodeURIComponent(q)}`, viewer)).json().items).sort();
    expect(await found('A1')).toEqual(['A1']);
    expect(await found('A_')).toEqual(['A_C']);
    expect(await found('a_')).toEqual(['A_C']);
    expect(await found('%')).toEqual(['AB']);
    expect(await found('0% s')).toEqual(['AB']);
    expect(await found('\\')).toEqual([]);
    await prisma.customer.deleteMany({ where: { organizationId, externalId: { in: ids } } });
  });

  it('settings saved at the same moment all stay: the lookup settings, one field each, and the organization settings', async () => {
    const organizationId = owner.user.organizationId;
    const saves = await Promise.all([
      send('PUT', '/customers/config', admin, { idLabel: 'Nomor Pelanggan' }),
      send('PUT', '/customers/config', admin, { timeoutMs: 7000 }),
      send('PUT', '/customers/config', admin, { secret: 'second-secret' }),
      send('PUT', '/customers/config', admin, { lookupUrl: `${lookupUrl}?v=2` }),
      send('PUT', '/organizations/current', admin, { settings: { theme: 'dark' } }),
    ]);
    expect(saves.map((res) => res.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const settings = (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).settings as any;
    expect(settings.theme).toBe('dark');
    expect(settings.customers).toMatchObject({ idLabel: 'Nomor Pelanggan', timeoutMs: 7000, lookupUrl: `${lookupUrl}?v=2` });
    expect(decrypt(settings.customers.lookupSecretEnc)).toBe('second-secret');
  });
});

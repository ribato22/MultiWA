// API integration (e2e) test — boots the real NestJS app (Fastify) against the CI
// postgres/redis, with the SAME global config as production (configureApp: prefix,
// helmet, ValidationPipe whitelist), and drives real HTTP requests. This exercises the
// full HTTP -> pipe -> guard -> controller -> service -> Prisma -> bcrypt path that unit
// tests (which mock Prisma and never run the pipe) cannot.
//
// The WhatsApp engine is stubbed so no Chromium/puppeteer or reconnect timer starts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { EngineManagerService } from '../src/modules/profiles/engine-manager.service';

const engineStub = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  getEngine: () => null,
  getStatus: () => 'DISCONNECTED',
};

// register() creates a fresh org + default workspace + "Default Account" + owner user.
let clientSeq = 0;
async function register(app: NestFastifyApplication, email: string): Promise<string> {
  clientSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    // Unique client IP per call: /auth/register carries @Throttle(5/min), which is
    // per-IP — a growing e2e suite from one IP would rate-limit itself (429). Each
    // registration is treated as a distinct client. (req.ip = socket addr; no trustProxy.)
    remoteAddress: `10.9.${Math.floor(clientSeq / 254) % 254}.${(clientSeq % 254) + 1}`,
    payload: { email, password: 'password1234!', name: 'U', organizationName: `Org-${email}` },
  });
  const token = res.json()?.accessToken;
  if (typeof token !== 'string') {
    throw new Error(`register failed: ${res.statusCode} — ${res.body}`);
  }
  return token;
}

const authGet = (app: NestFastifyApplication, url: string, token: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EngineManagerService)
      .useValue(engineStub)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('boots and answers the root route', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBeLessThan(500);
  });

  it('registers a user then logs in (HTTP -> pipe -> bcrypt -> Postgres)', async () => {
    const email = `e2e_${Date.now()}@test.local`;

    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'password1234!',
        name: 'E2E User',
        organizationName: 'E2E Org',
        // hostile extra: RegisterDto has no `role` — whitelist must strip it so the
        // caller can't self-assign a privileged role.
        role: 'super-admin',
      },
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json();
    expect(regBody.accessToken).toBeTruthy();
    expect(regBody.user.role).not.toBe('super-admin'); // extra field was stripped

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password1234!' },
    });
    expect([200, 201]).toContain(login.statusCode);
    expect(login.json().accessToken).toBeTruthy();
  });

  it('rejects a login with the wrong password (401)', async () => {
    const email = `e2e_${Date.now()}_b@test.local`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password1234!', name: 'B', organizationName: 'B Org' },
    });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('rejects a register missing required fields (ValidationPipe runs end-to-end)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'x@test.local', password: 'password1234!' }, // no name / organizationName
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires auth on a protected route (401 without a token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('enforces the 12-char register password floor (400 under, 201 at)', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `pw_${Date.now()}@test.local`, password: 'elevenchar1', name: 'P', organizationName: 'P Org' },
    });
    expect(short.statusCode).toBe(400); // 11 chars < 12

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `pw_ok_${Date.now()}@test.local`, password: 'twelvechars1', name: 'P', organizationName: 'P Org' },
    });
    expect(ok.statusCode).toBe(201); // exactly 12 chars
  });

  // Tenant isolation / IDOR: the TenantGuard must stop one org from reaching another
  // org's resources. Unit tests assert the guard is *applied* (route-coverage meta-test);
  // this proves it actually *blocks* over real HTTP + Prisma.
  describe('tenant isolation (IDOR)', () => {
    it("blocks cross-org access to another org's account, and scopes the list", async () => {
      const stamp = Date.now();
      const tokenA = await register(app, `idor_a_${stamp}@test.local`);
      const tokenB = await register(app, `idor_b_${stamp}@test.local`);
      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();

      // A owns a "Default Account" created at register time.
      const listA = await authGet(app, '/api/v1/accounts', tokenA);
      expect(listA.statusCode).toBe(200);
      const accountsA = listA.json();
      expect(Array.isArray(accountsA)).toBe(true);
      expect(accountsA.length).toBeGreaterThan(0);
      const accountIdA: string = accountsA[0].id;

      // Owner can read their own account.
      const ownerRead = await authGet(app, `/api/v1/accounts/${accountIdA}`, tokenA);
      expect(ownerRead.statusCode).toBe(200);

      // A different org's user cannot (TenantGuard → forbidden/not-found, never 200).
      const crossRead = await authGet(app, `/api/v1/accounts/${accountIdA}`, tokenB);
      expect([403, 404]).toContain(crossRead.statusCode);

      // B's account list must not leak A's account.
      const listB = await authGet(app, '/api/v1/accounts', tokenB);
      expect(listB.statusCode).toBe(200);
      expect((listB.json() as any[]).map((a) => a.id)).not.toContain(accountIdA);
    });

    it("blocks cross-org update and delete of another org's account", async () => {
      const stamp = Date.now();
      const tokenA = await register(app, `widor_a_${stamp}@test.local`);
      const tokenB = await register(app, `widor_b_${stamp}@test.local`);

      const accountIdA: string = (await authGet(app, '/api/v1/accounts', tokenA)).json()[0].id;

      // B cannot rename A's account (TenantGuard blocks the write, not just reads).
      const bUpdate = await app.inject({
        method: 'PUT',
        url: `/api/v1/accounts/${accountIdA}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: 'hacked-by-b' },
      });
      expect([403, 404]).toContain(bUpdate.statusCode);

      // B cannot delete A's account.
      const bDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/accounts/${accountIdA}`,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect([403, 404]).toContain(bDelete.statusCode);

      // A's account survives and was never renamed by B's blocked write.
      const aRead = await authGet(app, `/api/v1/accounts/${accountIdA}`, tokenA);
      expect(aRead.statusCode).toBe(200);
      expect(aRead.json().name).not.toBe('hacked-by-b');
    });
  });

  // API-key auth is how bots/integrations authenticate (not JWT). Exercises the
  // JwtOrApiKeyGuard + api-key passport strategy end-to-end.
  describe('API-key authentication', () => {
    it('creates a key and authenticates a request with x-api-key', async () => {
      const token = await register(app, `apikey_${Date.now()}@test.local`);
      expect(typeof token).toBe('string');

      // Sanity: the same token authenticates a known-good endpoint (isolates any
      // failure below to the api-keys route rather than the token).
      const sanity = await authGet(app, '/api/v1/accounts', token);
      expect(sanity.statusCode).toBe(200);

      // Create an API key (JWT-authed).
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'e2e-integration' },
      });
      expect([200, 201]).toContain(created.statusCode);
      const apiKey: string = created.json().key;
      expect(apiKey).toMatch(/^mwa_/); // raw key returned only on creation

      // The key authenticates a JwtOrApiKey-guarded endpoint.
      const withKey = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'x-api-key': apiKey },
      });
      expect(withKey.statusCode).toBe(200);

      // A bogus key is rejected.
      const bogus = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'x-api-key': 'mwa_not_a_real_key' },
      });
      expect(bogus.statusCode).toBe(401);
    });

    it('enforces API-key scopes: a message:read key is blocked from send but not from unscoped routes', async () => {
      const token = await register(app, `scope_${Date.now()}@test.local`);

      // A restricted, read-only messaging key.
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'read-only', permissions: ['message:read'] },
      });
      expect([200, 201]).toContain(created.statusCode);
      const readKey: string = created.json().key;

      // The scope gate runs before tenant/validation, so sending is a clean 403
      // (missing message:send) — not a 400/404 from the body/tenant.
      const send = await app.inject({
        method: 'POST',
        url: '/api/v1/messages/text',
        headers: { 'x-api-key': readKey },
        payload: { profileId: 'nonexistent', to: '628123', text: 'hi' },
      });
      expect(send.statusCode).toBe(403);

      // A route with no @RequireScope is unaffected by the key's scopes.
      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'x-api-key': readKey },
      });
      expect(list.statusCode).toBe(200);
    });
  });

  // Session revocation: logout must invalidate the access token server-side (a stolen
  // or logged-out JWT can't keep working until it expires).
  describe('session revocation', () => {
    it('logout invalidates the access token', async () => {
      const token = await register(app, `logout_${Date.now()}@test.local`);

      const before = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(before.statusCode).toBe(200);

      const logout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });
      expect([200, 201]).toContain(logout.statusCode);

      // The same token is now rejected (its session was removed).
      const after = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(after.statusCode).toBe(401);
    });
  });

  // Refresh tokens are revocable + rotated with reuse detection, so a leaked or
  // logged-out refresh token can't keep minting access tokens.
  describe('refresh token rotation & revocation', () => {
    it('rotates the refresh token and rejects reuse of the old one', async () => {
      // Dedicated client IP: /auth/register is per-IP throttled (5/min).
      const ip = '10.50.0.1';
      const email = `refresh_${Date.now()}@test.local`;
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: ip,
        payload: { email, password: 'password1234!', name: 'R', organizationName: 'R Org' },
      });
      expect(reg.statusCode).toBe(201);
      const r1: string = reg.json().refreshToken;
      expect(r1).toBeTruthy();

      // Rotate: exchange r1 for a fresh pair.
      const rot = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        remoteAddress: ip,
        payload: { refreshToken: r1 },
      });
      expect([200, 201]).toContain(rot.statusCode);
      const r2: string = rot.json().refreshToken;
      expect(r2).toBeTruthy();
      expect(r2).not.toBe(r1);

      // Replaying the now-rotated r1 is reuse → rejected, and it revokes the whole
      // family, so even the fresh r2 is dead afterwards.
      const reuse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        remoteAddress: ip,
        payload: { refreshToken: r1 },
      });
      expect(reuse.statusCode).toBe(401);

      const afterReuse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        remoteAddress: ip,
        payload: { refreshToken: r2 },
      });
      expect(afterReuse.statusCode).toBe(401);
    });

    it('logout revokes the refresh token (no new access tokens after logout)', async () => {
      const ip = '10.50.0.2';
      const email = `refreshlogout_${Date.now()}@test.local`;
      const reg = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        remoteAddress: ip,
        payload: { email, password: 'password1234!', name: 'R', organizationName: 'R Org' },
      });
      const { accessToken, refreshToken } = reg.json();

      const logout = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        remoteAddress: ip,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect([200, 201]).toContain(logout.statusCode);

      const refresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        remoteAddress: ip,
        payload: { refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    });
  });

  // Webhooks are profile-scoped; the profile is org-scoped, so webhook access is
  // isolated across orgs. (This is the surface behind the recent bot integration.)
  describe('webhooks (profile-scoped, cross-org isolation)', () => {
    it('creates a webhook for own profile and blocks another org', async () => {
      const stamp = Date.now();
      const tokenA = await register(app, `wh_a_${stamp}@test.local`);
      const tokenB = await register(app, `wh_b_${stamp}@test.local`);

      const accountIdA: string = (await authGet(app, '/api/v1/accounts', tokenA)).json()[0].id;

      // A creates a profile (mock engine — no real WhatsApp session).
      const profileRes = await app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${accountIdA}/profiles`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { displayName: 'e2e-profile', engine: 'mock' },
      });
      expect([200, 201]).toContain(profileRes.statusCode);
      const profileIdA: string = profileRes.json().id;
      expect(profileIdA).toBeTruthy();

      // A creates a webhook for that profile.
      const whCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { profileId: profileIdA, url: 'https://bot.example.com/hook', events: ['message.received'] },
      });
      expect([200, 201]).toContain(whCreate.statusCode);

      // A can list its own profile's webhooks.
      const listA = await authGet(app, `/api/v1/webhooks?profileId=${profileIdA}`, tokenA);
      expect(listA.statusCode).toBe(200);
      expect((listA.json() as any[]).length).toBeGreaterThan(0);

      // B cannot create a webhook on A's profile (TenantGuard on body.profileId).
      const bCreate = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks',
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { profileId: profileIdA, url: 'https://evil.example.com/hook', events: ['message.received'] },
      });
      expect([403, 404]).toContain(bCreate.statusCode);

      // B cannot list A's profile's webhooks either.
      const bList = await authGet(app, `/api/v1/webhooks?profileId=${profileIdA}`, tokenB);
      expect([403, 404]).toContain(bList.statusCode);
    });
  });
});

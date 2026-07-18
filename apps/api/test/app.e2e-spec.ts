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
async function register(app: NestFastifyApplication, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'password123', name: 'U', organizationName: `Org-${email}` },
  });
  return res.json().accessToken as string;
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
        password: 'password123',
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
      payload: { email, password: 'password123' },
    });
    expect([200, 201]).toContain(login.statusCode);
    expect(login.json().accessToken).toBeTruthy();
  });

  it('rejects a login with the wrong password (401)', async () => {
    const email = `e2e_${Date.now()}_b@test.local`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123', name: 'B', organizationName: 'B Org' },
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
      payload: { email: 'x@test.local', password: 'password123' }, // no name / organizationName
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires auth on a protected route (401 without a token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
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
      if (![200, 201].includes(created.statusCode)) {
        throw new Error(`create api-key failed: ${created.statusCode} — ${created.body}`);
      }
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
  });
});

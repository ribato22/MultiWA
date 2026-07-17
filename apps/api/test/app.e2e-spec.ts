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
});

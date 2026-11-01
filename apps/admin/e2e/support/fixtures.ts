// The fake backend the admin's pages run against, as Playwright fixtures: REST answered inside the browser, a real
// socket.io `/ws` for the realtime events, and a record of what the pages sent. Every test gets a fresh context.
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import media from './mediasoup.json';
import { installBrowserFakes } from './browser';

export { expect };

export const ME = { id: 'u-ada', name: 'Ada Agent', email: 'ada@example.com', role: 'admin', organizationId: 'org-1' };
export const PROFILE = {
  id: 'p-1',
  name: 'Line 1',
  displayName: 'Line 1',
  status: 'connected',
  workspaceId: 'w-1',
  phoneNumber: '628120000001',
  settings: { callsAnswerInDashboard: true },
  dailyMessageLimit: 1000,
  dailyMessageCount: 0,
  coldMessageCount: 0,
  messageDelayMs: 1500,
  messageDelayJitterMs: 0,
  createdAt: '2026-10-01T03:00:00.000Z',
  updatedAt: '2026-11-01T03:00:00.000Z',
};
/** `call:ringing` as the server sends it; a test overrides what it needs. */
export const ringing = (over: Record<string, unknown> = {}) => ({
  callId: 'call-1',
  profileId: PROFILE.id,
  profileName: 'Line 1',
  caller: { name: 'Pak Joko', number: '628111000111' },
  conversationId: 'conv-1',
  startedAt: new Date().toISOString(),
  answerable: true,
  recorded: false,
  ...over,
});
/** `GET /calls/media/status` of a server and a profile that are ready, before any setting is on. */
export const STATUS = {
  server: {
    enabled: true,
    worker: 'up',
    port: 40000,
    engineHost: 'api',
    activeSessions: 0,
    recordings: { storage: 'local', configured: true, problem: null, lastCheck: { at: '2026-11-01T02:30:00.000Z', ok: true } },
  },
  profiles: [{ profileId: PROFILE.id, name: 'Line 1', answerInDashboard: false, recording: false, retentionDays: 90, announcement: null, ready: true, reasons: [] as string[] }],
};

export type Req = { method: string; path: string; query: URLSearchParams; headers: Record<string, string>; body: Buffer | null };
export type Reply = { status?: number; json?: unknown; body?: Buffer | string; headers?: Record<string, string> };
export type Rest = (req: Req) => Reply | undefined;
type Command = (args: any) => unknown | Promise<unknown>;

/** A REST route: `path` is the API path after `/api/v1`. */
export const on = (method: string, path: string | RegExp, reply: Reply | ((req: Req) => Reply)): Rest => (req) =>
  req.method === method && (typeof path === 'string' ? req.path === path : path.test(req.path))
    ? typeof reply === 'function' ? reply(req) : reply
    : undefined;
export const get = (path: string | RegExp, json: unknown): Rest => on('GET', path, { json });

const DEFAULT_REST: Rest[] = [
  get('/auth/me', ME),
  get('/auth/preferences', {}),
  get('/profiles', [PROFILE]),
  get('/notifications/unread-count', { count: 0 }),
  get('/conversations/unread-count', { count: 0 }),
  get('/calls/open-count', { count: 0 }),
  get('/notifications', { notifications: [], total: 0 }),
  get('/accounts', [{ id: 'acc-1', name: 'Test' }]),
  get(`/accounts/acc-1/profiles/${PROFILE.id}`, PROFILE),
  get('/calls', { calls: [], nextCursor: null }),
  get('/calls/media/status', STATUS),
  get('/organizations/members', [{ id: ME.id, name: ME.name, email: ME.email, role: ME.role, isActive: true }]),
  get('/api-keys', []),
  get('/webhooks', []),
];

/** `call:media` against no SFU: the captured parameters, which mediasoup-client completes against. */
const replay = (a: any) =>
  a.op === 'rtpCapabilities' ? media.routerRtpCapabilities
  : a.op === 'createTransport' ? (a.direction === 'recv' ? media.recv : media.send)
  : a.op === 'consume' ? media.consumer
  : a.op === 'produce' ? { id: 'agent-producer' }
  : null;

export class FakeBackend {
  readonly sent: Array<{ event: string; args: any }> = [];
  readonly requests: Req[] = [];
  readonly joined: string[] = [];
  /** The server's availability of the agent. */
  available = true;
  private readonly rest: Rest[] = [];
  private readonly replies: Record<string, Command> = {};
  /** The server's normal replies; a test's `reply` can delegate to them. */
  readonly defaults: Record<string, Command> = {
    'call:availability': (a) => {
      if (typeof a?.available === 'boolean') this.available = a.available;
      return { ok: true, available: this.available };
    },
    'call:answer': (a) => ({ ok: true, callId: a.callId, callerProducerId: media.consumer.producerId, iceServers: [] }),
    'call:rejoin': (a) => ({ ok: true, callId: a.callId, callerProducerId: media.consumer.producerId, iceServers: [] }),
    'call:hangup': () => ({ ok: true }),
    'call:media': (a) => ({ ok: true, result: replay(a) }),
  };

  constructor(private readonly io: Server) {}

  /** A REST answer of this test; the newest route wins over older ones and over the defaults. */
  route(r: Rest) {
    this.rest.unshift(r);
  }
  /** This test's reply to a `call:*` command (a promise holds the ack until it settles). */
  reply(event: string, fn: Command) {
    this.replies[event] = fn;
  }
  /** A server event to the agent's sockets: every page of a test is the same agent. */
  emit(event: string, payload: unknown) {
    this.io.of('/ws').to(`user:${ME.id}`).emit(event, payload);
  }
  /** A server event to the sockets that joined `profileId`'s room. */
  emitToProfile(profileId: string, event: string, payload: unknown) {
    this.io.of('/ws').to(`profile:${profileId}`).emit(event, payload);
  }
  /** The `call:*` commands the pages sent, by name, oldest first. */
  commands(event: string) {
    return this.sent.filter((s) => s.event === event).map((s) => s.args);
  }
  /** The server closes every socket (`io server disconnect`), as a revoked login does. */
  dropSockets() {
    this.io.of('/ws').disconnectSockets(true);
  }

  async command(event: string, args: any) {
    this.sent.push({ event, args });
    return (this.replies[event] ?? this.defaults[event])(args);
  }

  serve(req: Req): Reply {
    this.requests.push(req);
    for (const r of [...this.rest, ...DEFAULT_REST]) {
      const out = r(req);
      if (out) return out;
    }
    return { json: {} };
  }
}

const COMMANDS = ['call:availability', 'call:answer', 'call:rejoin', 'call:hangup', 'call:media'];
let current: FakeBackend | null = null;

async function fulfill(backend: FakeBackend, route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const out = backend.serve({
    method: req.method(),
    path: url.pathname.replace(/^\/api\/v1/, ''),
    query: url.searchParams,
    headers: req.headers(),
    body: req.postDataBuffer(),
  });
  await route.fulfill({ status: out.status ?? 200, headers: out.headers, ...(out.body !== undefined ? { body: out.body } : { json: out.json ?? {} }) });
}

export const test = base.extend<{ backend: FakeBackend; user: typeof ME }, { fakeServer: Server }>({
  // One socket.io server for the run, on the port the pages are built for; each test's backend serves it.
  fakeServer: [
    async ({}, use) => {
      const http = createServer();
      const io = new Server(http, { cors: { origin: true, credentials: true } });
      io.of('/ws').on('connection', (socket: Socket) => {
        socket.join(`user:${ME.id}`);
        socket.on('join', (p: { profileId: string }, ack?: (r: unknown) => void) => {
          current?.joined.push(p.profileId);
          socket.join(`profile:${p.profileId}`);
          ack?.({ success: true, profileId: p.profileId });
        });
        for (const event of COMMANDS) {
          socket.on(event, async (args: unknown, ack?: (r: unknown) => void) => {
            const reply = await current?.command(event, args);
            if (typeof ack === 'function') ack(reply);
          });
        }
      });
      // The port the pages' NEXT_PUBLIC_API_URL names (playwright.config.ts).
      await new Promise<void>((resolve) => http.listen(Number(process.env.E2E_API_PORT ?? 3000), 'localhost', resolve));
      await use(io);
      io.close();
    },
    { scope: 'worker' },
  ],
  user: [ME, { option: true }],
  backend: async ({ fakeServer, context, user }, use) => {
    const backend = new FakeBackend(fakeServer);
    current = backend;
    const errors: string[] = [];
    const watch = (p: Page) => p.on('pageerror', (e) => errors.push(e.message));
    context.pages().forEach(watch);
    context.on('page', watch);
    await context.addInitScript(installBrowserFakes);
    await context.addInitScript((u) => {
      localStorage.setItem('user', JSON.stringify(u));
      localStorage.setItem('accessToken', 'test-token');
      localStorage.setItem('refreshToken', 'test-refresh');
    }, user);
    await context.route('**/api/v1/**', (route) => fulfill(backend, route));
    await use(backend);
    backend.dropSockets();
    current = null;
    expect(errors, 'uncaught errors in the pages').toEqual([]);
  },
  // Every page of a test runs against the backend: it is set up before the page is used.
  page: async ({ page, backend: _backend }, use) => {
    await use(page);
  },
});

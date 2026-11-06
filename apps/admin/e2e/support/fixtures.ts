// The fake backend the admin's pages run against, as Playwright fixtures: REST answered inside the browser, a real
// socket.io `/ws` for the realtime events, and a record of what the pages sent. Every test gets a fresh context.
import { test as base, expect, type Page, type Route } from '@playwright/test';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { Server, type Socket } from 'socket.io';
import media from './mediasoup.json';
import { installBrowserFakes } from './browser';

export { expect };

// An admin, not the server owner (the owner of the oldest organization, who alone sets storage and SMTP).
export const ME = { id: 'u-ada', name: 'Ada Agent', email: 'ada@example.com', role: 'admin', organizationId: 'org-1', isServerOwner: false };
export const PROFILE = {
  id: 'p-1',
  name: 'Line 1',
  displayName: 'Line 1',
  status: 'connected',
  workspaceId: 'w-1',
  phoneNumber: '628120000001',
  // On, so the console shows its controls; STATUS has it off, for the settings tests to turn on.
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
  isVideo: false,
  answerable: true,
  recorded: false,
  ...over,
});
/** `GET /calls/media/status` of a server and a profile that are ready, before any setting is on (the settings tests turn them on). */
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
export type Rest = (req: Req) => Reply | Promise<Reply> | undefined;
type Command = (args: any) => unknown | Promise<unknown>;

/** A REST route: `path` is the API path after `/api/v1`. A promise holds the answer until it settles, as a slow link. */
export const on = (method: string, path: string | RegExp, reply: Reply | ((req: Req) => Reply | Promise<Reply>)): Rest => (req) =>
  req.method === method && (typeof path === 'string' ? req.path === path : path.test(req.path))
    ? typeof reply === 'function' ? reply(req) : reply
    : undefined;
export const get = (path: string | RegExp, json: unknown): Rest => on('GET', path, { json });
/** Settles once the page's request to a URL containing `part` ends: answered, or given up by the page. */
export const requestEnded = (page: Page, part: string) =>
  new Promise<void>((resolve) => {
    const ended = (r: { url(): string }) => void (r.url().includes(part) && resolve());
    page.on('requestfinished', ended).on('requestfailed', ended);
  });
/**
 * Settles once the page has rendered twice. Chrome moves the focus off an element that became disabled only when it
 * renders, so a check that the focus stayed put waits for this first.
 */
export const rendered = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
/**
 * The toasts' region, each toast a list item in it. Radix also announces a toast in a `role="status"` copy of its text,
 * outside the region and gone after a second: a locator on the whole page matches that copy too, or only it.
 */
export const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications (F8)' });
/** A gate for a reply to wait at: what awaits `passed` goes on once the test calls `open()`. */
export function gate() {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => (open = resolve));
  return { passed, open };
}

// `/auth/me` is the `user` option's, routed by the backend fixture.
const DEFAULT_REST: Rest[] = [
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
  // A call no test routed is one the server does not have. Unrouted, it would read `{}`: a call that stopped ringing,
  // and the re-read at a reconnect would end every banner.
  on('GET', /^\/calls\/[^/]+$/, { status: 404, json: { message: 'Call not found' } }),
];

/** The caller's picture on a call answered with video: what a test's `call:answer` reply names (`callerVideoProducerId`). */
export const CALLER_VIDEO_PRODUCER = media.videoConsumer.producerId;

/**
 * `call:media` against no SFU: the parameters capture-mediasoup.mjs captured, which mediasoup-client completes
 * against. A consume of the caller's picture gets its video consumer, any other the voice's.
 */
const replay = (a: any) =>
  a.op === 'rtpCapabilities' ? media.routerRtpCapabilities
  : a.op === 'createTransport' ? (a.direction === 'recv' ? media.recv : media.send)
  : a.op === 'consume' ? (a.producerId === CALLER_VIDEO_PRODUCER ? media.videoConsumer : media.consumer)
  : null;

export class FakeBackend {
  readonly sent: Array<{ event: string; args: any }> = [];
  readonly requests: Req[] = [];
  readonly joined: string[] = [];
  /** The server's availability of the agent: kept through a reload, as within the agent grace; a test resets it. */
  available = true;
  /** While set, the server refuses new connections: a page whose socket dropped keeps trying (its network is down). */
  offline = false;
  /** The agent's voices and cameras produced so far: each its own id, as the server's are (`agent-producer-1` first). */
  private produced = 0;
  private readonly rest: Rest[] = [];
  private readonly replies: Record<string, Command> = {};
  /** The server's normal replies; a test's `reply` can delegate to them. */
  readonly defaults: Record<string, Command> = {
    'call:availability': (a) => {
      if (typeof a?.available === 'boolean') this.available = a.available;
      return { ok: true, available: this.available };
    },
    // A voice call; a test answers one with video by naming CALLER_VIDEO_PRODUCER in its reply.
    'call:answer': (a) => ({ ok: true, callId: a.callId, callerProducerId: media.consumer.producerId, callerVideoProducerId: null, iceServers: [] }),
    'call:rejoin': (a) => ({ ok: true, callId: a.callId, callerProducerId: media.consumer.producerId, callerVideoProducerId: null, cameraOn: false, iceServers: [] }),
    'call:hangup': () => ({ ok: true }),
    'call:camera': (a) => ({ ok: true, on: a.on }),
    'call:media': (a) => ({
      ok: true,
      result: a.op === 'produce' ? { id: `${a.kind === 'video' ? 'agent-camera' : 'agent-producer'}-${++this.produced}` } : replay(a),
    }),
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
  /**
   * The reply to a `call:rejoin` made while the answer itself still connects: the server gives the answer up, as Hang up
   * does, says so (`call:ended`, cancelled) and rings the call again, then replies. `missed`: neither event reached the
   * page.
   */
  undoAnswer(callId: string, missed = false) {
    if (!missed) {
      this.emit('call:ended', { callId, endReason: 'cancelled' });
      this.emit('call:ringing', ringing({ callId }));
    }
    return { ok: false, reason: 'answer_undone' };
  }
  /** The `call:*` commands the pages sent, by name, oldest first. */
  commands(event: string) {
    return this.sent.filter((s) => s.event === event).map((s) => s.args);
  }
  /** The server closes every socket (`io server disconnect`), as a revoked login does. */
  dropSockets() {
    this.io.of('/ws').disconnectSockets(true);
  }
  /** Every socket's connection drops, as when the network goes: the pages reconnect by themselves (see `offline`). */
  blip() {
    for (const socket of this.io.of('/ws').sockets.values()) socket.conn.close();
  }

  async command(event: string, args: any) {
    this.sent.push({ event, args });
    return (this.replies[event] ?? this.defaults[event])(args);
  }

  serve(req: Req): Reply | Promise<Reply> {
    this.requests.push(req);
    for (const r of [...this.rest, ...DEFAULT_REST]) {
      const out = r(req);
      if (out) return out;
    }
    return { json: {} };
  }
}

const COMMANDS = ['call:availability', 'call:answer', 'call:rejoin', 'call:hangup', 'call:camera', 'call:media'];
let current: FakeBackend | null = null;

async function fulfill(backend: FakeBackend, route: Route) {
  const req = route.request();
  const url = new URL(req.url());
  const out = await backend.serve({
    method: req.method(),
    path: url.pathname.replace(/^\/api\/v1/, ''),
    query: url.searchParams,
    headers: req.headers(),
    body: req.postDataBuffer(),
  });
  await route.fulfill({ status: out.status ?? 200, headers: out.headers, ...(out.body !== undefined ? { body: out.body } : { json: out.json ?? {} }) });
}

/** Whether something accepts connections on `host:port`. */
const accepts = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port, timeout: 500 });
    const done = (taken: boolean) => {
      socket.destroy();
      resolve(taken);
    };
    socket.once('connect', () => done(true)).once('timeout', () => done(false)).on('error', () => done(false));
  });

export const test = base.extend<{ backend: FakeBackend; user: typeof ME }, { fakeServer: Server }>({
  // One socket.io server for the run, on the port the pages are built for; each test's backend serves it.
  fakeServer: [
    async ({}, use) => {
      // The port the pages' NEXT_PUBLIC_API_URL names (playwright.config.ts).
      const port = Number(process.env.E2E_API_PORT);
      // A port in use, on either address of localhost, is refused: the listen below binds one address only, and can
      // even succeed beside another server's wildcard bind, silently sharing that server's traffic.
      for (const host of ['127.0.0.1', '::1']) {
        if (await accepts(host, port)) throw new Error(`Port ${port} is in use: set E2E_API_PORT to a free port`);
      }
      // Plain HTTP answers 404: a page's request here outside /socket.io/ fails at once instead of holding up its load.
      const http = createServer((_req, res) => res.writeHead(404).end());
      const io = new Server(http, { cors: { origin: true, credentials: true }, allowRequest: (_req, ok) => ok(null, !current?.offline) });
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
      await new Promise<void>((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, 'localhost', resolve);
      });
      await use(io);
      await io.close();
    },
    { scope: 'worker' },
  ],
  user: [ME, { option: true }],
  // Automatic, so every test of this `test` runs against the backend, set up before its first page.
  backend: [
    async ({ fakeServer, context, user }, use) => {
      const backend = new FakeBackend(fakeServer);
      backend.route(get('/auth/me', user));
      current = backend;
      const errors: string[] = [];
      const watch = (p: Page) => p.on('pageerror', (e) => errors.push(e.message));
      // A reused context (PW_TEST_REUSE_CONTEXT, the VS Code extension's "Show browser") already has its page, with no
      // `page` event for it.
      context.pages().forEach(watch);
      context.on('page', watch);
      await context.addInitScript(installBrowserFakes);
      await context.addInitScript((u) => {
        if (window.origin === 'null') return; // the blank page a new tab opens on: it has no storage
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
    { auto: true },
  ],
});

// fetchLookup against a lookup endpoint on this machine: the request it makes, the state it reads from each answer, the
// cap on an answer's size, the timeout, the redirect it does not follow, and the webhooks' SSRF rule. The server listens
// on [::1]: with private targets allowed, the rule sends 127.0.0.1 and localhost to host.docker.internal.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_LOOKUP_BYTES, fetchLookup, type LookupTarget } from './lookup';

type Answer = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(handler: Answer): Promise<{ server: Server; base: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
  return { server, base: `http://[::1]:${(server.address() as AddressInfo).port}` };
}
function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
const json = (status: number, body: unknown): Answer => (_req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

describe('fetchLookup', () => {
  let server: Server;
  let base: string;
  let answer: Answer;
  const seen: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
  const target = (over: Partial<LookupTarget> = {}): LookupTarget => ({ url: `${base}/lookup?source=crm`, secret: 'tok-123', timeoutMs: 2000, ...over });

  beforeAll(async () => {
    ({ server, base } = await listen((req, res) => {
      seen.push({ url: req.url ?? '', headers: req.headers });
      answer(req, res);
    }));
  });
  afterAll(() => close(server));
  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('asks GET <url>&id=<externalId> for JSON, as MultiWA, with the bearer secret; a 200 in the format is ok', async () => {
    answer = json(200, { id: '1234567890', name: 'Budi Santoso', fields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }], extra: true });
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({
      state: 'ok',
      status: 200,
      data: { id: '1234567890', name: 'Budi Santoso', fields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }], sections: [] },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/lookup?source=crm&id=1234567890');
    expect(seen[0].headers).toMatchObject({ authorization: 'Bearer tok-123', accept: 'application/json' });
    expect(seen[0].headers['user-agent']).toMatch(/^MultiWA\/\d+\.\d+\.\d+/);
  });

  it('sends no Authorization header without a secret', async () => {
    answer = json(200, {});
    await fetchLookup(target({ secret: null }), '1234567890');
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it('a 404 is not_found', async () => {
    answer = json(404, { error: 'no such customer' });
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'not_found', status: 404, data: null });
  });

  it.each([500, 401, 204])('any other status (%i) is unavailable', async (status) => {
    answer = (_req, res) => {
      res.writeHead(status);
      res.end();
    };
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status, data: null, problem: 'status' });
  });

  it('follows no redirect', async () => {
    answer = (req, res) => {
      if (req.url?.startsWith('/elsewhere')) return json(200, { name: 'Budi Santoso' })(req, res);
      res.writeHead(302, { Location: '/elsewhere' });
      res.end();
    };
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status: 302, problem: 'status' });
    expect(seen.map((s) => s.url)).toEqual(['/lookup?source=crm&id=1234567890']);
  });

  it('gives up after timeoutMs', async () => {
    answer = () => undefined; // never answers
    const started = Date.now();
    expect(await fetchLookup(target({ timeoutMs: 300 }), '1234567890')).toMatchObject({ state: 'unavailable', status: null, problem: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('reads an answer of exactly 64 KB, and stops one byte past it', async () => {
    const shell = JSON.stringify({ name: 'Budi Santoso', pad: '' });
    const full = JSON.stringify({ name: 'Budi Santoso', pad: 'x'.repeat(MAX_LOOKUP_BYTES - shell.length) });
    expect(full).toHaveLength(MAX_LOOKUP_BYTES);
    answer = json(200, full);
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'ok', data: { name: 'Budi Santoso' } });
    answer = json(200, `${full} `);
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status: 200, problem: 'too_large' });
  });

  it('invalid JSON, or JSON outside the format, is unavailable', async () => {
    answer = json(200, '{"name": "Budi');
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status: 200, problem: 'invalid_json' });
    answer = json(200, { name: 'x'.repeat(201) });
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status: 200, problem: 'invalid_body', data: null });
  });

  it('a target nobody listens on is unavailable', async () => {
    const gone = await listen(() => undefined);
    await close(gone.server);
    expect(await fetchLookup(target({ url: `${gone.base}/lookup` }), '1234567890')).toMatchObject({ state: 'unavailable', status: null, problem: 'network' });
  });

  it('refuses a private target unless WEBHOOK_ALLOW_PRIVATE_TARGETS=true, and never calls it', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'false');
    answer = json(200, {});
    expect(await fetchLookup(target(), '1234567890')).toMatchObject({ state: 'unavailable', status: null, problem: 'refused' });
    expect(seen).toHaveLength(0);
  });
});

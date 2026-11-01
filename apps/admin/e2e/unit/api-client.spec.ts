// The admin's API client, against a stubbed fetch (no browser, no server).
import { test, expect } from '@playwright/test';
import { api } from '@/lib/api';

// The globals a test stubs: fetch, and for a signed-in page window and localStorage. Each is put back after the test.
const GLOBALS = ['fetch', 'window', 'localStorage'];
const real = GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const stub = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

const calls: string[] = [];
test.beforeEach(() => {
  calls.length = 0;
});
test.afterEach(() => {
  for (const [name, d] of real) {
    if (d) Object.defineProperty(globalThis, name, d);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

function answerWith(status: number, body: unknown, type = 'application/json') {
  stub('fetch', async (url: string) => {
    calls.push(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  });
}

/** A signed-in page: its location, and both tokens in a localStorage of its own. */
function signedIn() {
  const store = new Map([['accessToken', 'old-token'], ['refreshToken', 'old-refresh']]);
  stub('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  const window = { location: { href: '/dashboard/calls' } };
  stub('window', window);
  return { store, window };
}

test('a refused change keeps its error body: the reasons of a 409 reach the page', async () => {
  answerWith(409, { message: 'Recording calls is not available for this profile', reasons: ['no_announcement'] });
  const res = await api.updateCallsSettings('p-1', { recording: true });
  expect(res).toMatchObject({ status: 409, error: 'Recording calls is not available for this profile', body: { reasons: ['no_announcement'] } });
});

test('a recording comes back as bytes, its download asks for an attachment, and a byte route’s error reads as its message', async () => {
  answerWith(200, 'RIFF-bytes', 'audio/webm');
  const ok = await api.fetchCallRecording('c-1');
  expect(ok.status).toBe(200);
  expect(await ok.blob!.text()).toBe('RIFF-bytes');
  await api.fetchCallRecording('c-1', true);
  expect(calls).toEqual(['/api/v1/calls/c-1/recording', '/api/v1/calls/c-1/recording?download=1']);
  answerWith(404, { message: 'This call has no recording' });
  expect(await api.fetchCallRecording('c-1')).toEqual({ status: 404, error: 'This call has no recording' });
});

test('a byte route that answers 401 refreshes the token once, and its retry carries the new token', async () => {
  const { store } = signedIn();
  const sent: Array<{ url: string; authorization?: string; body?: unknown }> = [];
  stub('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    sent.push({ url, authorization: headers.Authorization, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/v1/auth/refresh') return Response.json({ accessToken: 'new-token', refreshToken: 'new-refresh' });
    return headers.Authorization === 'Bearer new-token'
      ? new Response('RIFF-bytes', { headers: { 'content-type': 'audio/webm' } })
      : Response.json({ message: 'Unauthorized' }, { status: 401 });
  });
  const res = await api.fetchCallRecording('c-1');
  expect(sent).toEqual([
    { url: '/api/v1/calls/c-1/recording', authorization: 'Bearer old-token', body: undefined },
    { url: '/api/v1/auth/refresh', authorization: undefined, body: { refreshToken: 'old-refresh' } },
    { url: '/api/v1/calls/c-1/recording', authorization: 'Bearer new-token', body: undefined },
  ]);
  expect(res.status).toBe(200);
  expect(await res.blob!.text()).toBe('RIFF-bytes');
  expect(Object.fromEntries(store)).toEqual({ accessToken: 'new-token', refreshToken: 'new-refresh' });
});

test('a failed refresh signs out: both tokens cleared, and the page sent to the login', async () => {
  const { store, window } = signedIn();
  stub('fetch', async () => Response.json({ message: 'Unauthorized' }, { status: 401 }));
  expect(await api.fetchCallRecording('c-1')).toEqual({ status: 401, error: 'Unauthorized' });
  expect(store.size).toBe(0);
  expect(window.location.href).toBe('/auth/login');
});

const announcement = (bytes: number) => new File([new Uint8Array(bytes)], 'notice.mp3', { type: 'audio/mpeg' });
const MAX = 2 * 1024 * 1024; // the API's limit

test('a proxy’s size refusal (an HTML 413) blames the file only when it is past the API’s limit', async () => {
  answerWith(413, '<html><body>413 Request Entity Too Large</body></html>', 'text/html');
  const proxyLimit = { status: 413, error: 'The server refused a file of this size: ask your administrator to allow uploads up to 2 MB' };
  expect(await api.uploadCallsAnnouncement('p-1', announcement(10))).toMatchObject(proxyLimit);
  expect(await api.uploadCallsAnnouncement('p-1', announcement(MAX))).toMatchObject(proxyLimit); // the API takes exactly 2 MB
  expect(await api.uploadCallsAnnouncement('p-1', announcement(MAX + 1))).toMatchObject({ status: 413, error: 'The file must be at most 2 MB' });
});

test('a 413 from the API itself keeps its own message', async () => {
  answerWith(413, { statusCode: 413, message: 'Request body is too large', error: 'Payload Too Large' });
  expect(await api.uploadCallsAnnouncement('p-1', announcement(10))).toMatchObject({ status: 413, error: 'Request body is too large' });
});

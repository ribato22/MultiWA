import { test, expect, get, on, ringing, ME, PROFILE } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const toggle = (page: Page) => page.getByRole('switch', { name: 'Available for calls' });
/** Two animation frames: React has rendered the updates already queued. */
const nextFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('an agent is online and available on every page once the console connects, and can step away', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(backend.commands('call:availability')[0]).toEqual({}); // a read: the server keeps the state
  await toggle(page).click();
  await expect.poll(() => backend.commands('call:availability').at(-1)).toEqual({ available: false });
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  backend.emit('call:availability', { available: true }); // another tab turned it back on
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expectAccessible(page, '[aria-label="Calls availability"]');
});

test('a reload keeps the agent unavailable: the server kept it, and the console only reads it', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await toggle(page).click();
  await expect.poll(() => backend.commands('call:availability').at(-1)).toEqual({ available: false });
  const sent = backend.commands('call:availability').length;
  await page.reload();
  await expect(toggle(page)).toBeEnabled(); // connected: an offline switch reads unchecked too
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(backend.commands('call:availability').slice(sent)).toEqual([{}]);
});

test('after the server forgot it (no socket for the grace), a reload reads available', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await toggle(page).click();
  await expect.poll(() => backend.commands('call:availability').at(-1)).toEqual({ available: false });
  const sent = backend.commands('call:availability').length;
  backend.available = true; // the grace passed: the server is back to available
  await page.reload();
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(backend.commands('call:availability').slice(sent)).toEqual([{}]); // a read, not this tab's old "off"
});

test('a socket the server closed stays offline with the same login', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  const reads = backend.commands('call:availability').length;
  backend.dropSockets();
  await expect(page.getByText('Calls offline')).toBeVisible();
  await expect(toggle(page)).toBeDisabled();
  await page.waitForTimeout(1500);
  expect(backend.commands('call:availability').length).toBe(reads);
});

test('a socket the server closed once the token is gone (signed out in another tab) does not connect again', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  const reads = backend.commands('call:availability').length;
  await page.evaluate(() => localStorage.removeItem('accessToken'));
  backend.dropSockets();
  await expect(page.getByText('Calls offline')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(backend.commands('call:availability').length).toBe(reads);
});

test('after a token refresh, a socket the server closed connects again', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  const reads = backend.commands('call:availability').length;
  await page.evaluate(() => localStorage.setItem('accessToken', 'refreshed-token'));
  backend.dropSockets();
  await expect.poll(() => backend.commands('call:availability').length).toBeGreaterThan(reads);
  await expect(toggle(page)).toBeEnabled();
});

test("another tab's newer choice wins at a reload", async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  backend.available = true; // another tab turned it back on
  backend.emit('call:availability', { available: true });
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  const sent = backend.commands('call:availability').length;
  await page.reload();
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(backend.commands('call:availability').slice(sent)).toEqual([{}]); // a read, not this tab's old "off"
});

test('a refused toggle changes nothing, and says so', async ({ page, backend }) => {
  backend.reply('call:availability', (a) => (a?.available === false ? { ok: false, reason: 'error' } : backend.defaults['call:availability'](a)));
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await toggle(page).click();
  await expect(page.getByRole('region', { name: /^Notifications/ }).getByText('Your availability did not change')).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  const sent = backend.commands('call:availability').length;
  await page.reload();
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  expect(backend.commands('call:availability').slice(sent)).toEqual([{}]); // the refused "off" is not sent again
});

test('a failed read at connect is tried once more', async ({ page, backend }) => {
  let failed = false;
  backend.reply('call:availability', (a) => {
    if (failed) return backend.defaults['call:availability'](a);
    failed = true;
    return { ok: false, reason: 'error' };
  });
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  expect(backend.commands('call:availability')).toEqual([{}, {}]);
});

test('a socket the server closed for an expired token connects again once a request refreshed it', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  // The access token expired: the next request gets a 401, and the refresh a new token.
  let expired = true;
  backend.route((req) => {
    if (!expired || req.method !== 'GET' || req.path !== '/auth/me') return undefined;
    expired = false;
    return { status: 401, json: { message: 'Unauthorized' } };
  });
  backend.route(on('POST', '/auth/refresh', { json: { accessToken: 'refreshed-token', refreshToken: 'r2' } }));
  const reads = backend.commands('call:availability').length;
  backend.dropSockets();
  await expect.poll(() => backend.commands('call:availability').length).toBeGreaterThan(reads);
  await expect(toggle(page)).toBeEnabled();
});

test('without a profile that answers in the dashboard, the header has no call controls until a call rings', async ({ page, backend }) => {
  backend.route(get('/profiles', [{ ...PROFILE, settings: {} }]));
  const profiles = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/profiles');
  await page.goto('/dashboard/calls');
  await profiles;
  await nextFrames(page);
  await expect.poll(() => backend.commands('call:availability').length).toBeGreaterThan(0); // still online: a ring would show
  await expect(toggle(page)).toHaveCount(0);
  // A ring proves a profile answers here: the controls come, and stay once the call is gone.
  backend.emit('call:ringing', ringing());
  await expect(toggle(page)).toBeVisible();
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(page.getByRole('region', { name: 'Incoming calls' })).toHaveCount(0);
  await expect(toggle(page)).toBeVisible();
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('takes no calls: no console socket, no toggle', async ({ page, backend }) => {
    await page.goto('/dashboard/calls');
    await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible(); // not the empty state's "No calls here"
    await page.waitForTimeout(1500);
    expect(backend.commands('call:availability')).toEqual([]);
    await expect(toggle(page)).toHaveCount(0);
  });
});

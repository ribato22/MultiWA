import { test, expect, get, ME, PROFILE } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const toggle = (page: Page) => page.getByRole('switch', { name: 'Available for calls' });

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

test('a reload keeps the agent unavailable, though the server forgot it with the tab', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await toggle(page).click();
  await expect.poll(() => backend.commands('call:availability').at(-1)).toEqual({ available: false });
  backend.available = true; // the agent's last socket went: the server is back to available
  await page.reload();
  await expect(toggle(page)).toBeEnabled(); // connected: an offline switch reads unchecked too
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  expect(backend.commands('call:availability').at(-1)).toEqual({ available: false });
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

test('after a token refresh, a socket the server closed connects again', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toBeEnabled();
  const reads = backend.commands('call:availability').length;
  await page.evaluate(() => localStorage.setItem('accessToken', 'refreshed-token'));
  backend.dropSockets();
  await expect.poll(() => backend.commands('call:availability').length).toBeGreaterThan(reads);
  await expect(toggle(page)).toBeEnabled();
});

test('without a profile that answers in the dashboard, the header has no call controls', async ({ page, backend }) => {
  backend.route(get('/profiles', [{ ...PROFILE, settings: {} }]));
  await page.goto('/dashboard/calls');
  await expect.poll(() => backend.commands('call:availability').length).toBeGreaterThan(0); // still online: a ring would show
  await expect(toggle(page)).toHaveCount(0);
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

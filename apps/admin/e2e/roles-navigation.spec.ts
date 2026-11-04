// Which dashboard pages each role gets: every read of Webhooks and Audit is an owner's or admin's.
import { test, expect, gate, on, rendered, requestEnded, ME } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const sidebarLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name, exact: true });
const storedUser = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('user') ?? 'null'));
/** The pages that create what a link everyone has lists: each with the title of its form. */
const CREATE_PAGES = [
  ['/dashboard/profiles/new', 'Add New Profile'],
  ['/dashboard/automation/builder', 'Visual Flow Builder'],
] as const;

test('an admin has Webhooks and Audit in the sidebar', async ({ page }) => {
  await page.goto('/dashboard/api-keys');
  await expect(sidebarLink(page, 'Webhooks')).toBeVisible();
  await expect(sidebarLink(page, 'Audit')).toBeVisible();
});

for (const [path, title] of CREATE_PAGES) {
  test(`an admin opens ${path} and gets its form`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not available for your role' })).toHaveCount(0);
  });
}

test.describe('a member made an admin since signing in', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('gets Webhooks without signing out or reloading, and the stored user says admin', async ({ page, backend }) => {
    const slow = gate();
    backend.route(on('GET', '/auth/me', async () => {
      await slow.passed;
      return { json: { ...ME, role: 'admin' } };
    }));
    await page.goto('/dashboard/api-keys');
    await expect(sidebarLink(page, 'Chat')).toBeVisible();
    await expect(sidebarLink(page, 'Webhooks')).toHaveCount(0); // the role it signed in with
    slow.open();
    await expect(sidebarLink(page, 'Webhooks')).toBeVisible();
    expect(await storedUser(page)).toEqual({ ...ME, role: 'admin' });
  });

  test('keeps the role it signed in with when /auth/me fails', async ({ page, backend }) => {
    backend.route(on('GET', '/auth/me', { status: 500, json: { message: 'Internal server error' } }));
    const answered = requestEnded(page, '/auth/me');
    await page.goto('/dashboard/webhooks');
    await answered;
    await rendered(page);
    await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible();
    expect(await storedUser(page)).toEqual({ ...ME, role: 'member' });
  });
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('has neither Webhooks nor Audit in the sidebar, nor the Webhooks link of Settings', async ({ page }) => {
      await page.goto('/dashboard/settings?tab=api');
      const panel = page.getByRole('tabpanel');
      await expect(panel.getByRole('link', { name: /API Keys/ })).toBeVisible();
      await expect(panel.getByRole('link', { name: /Webhooks/ })).toHaveCount(0);
      await expect(sidebarLink(page, 'Chat')).toBeVisible();
      await expect(sidebarLink(page, 'Webhooks')).toHaveCount(0);
      await expect(sidebarLink(page, 'Audit')).toHaveCount(0);
    });

    for (const path of ['/dashboard/webhooks', '/dashboard/audit']) {
      test(`opening ${path} by its address says it is not for this role, and reads nothing`, async ({ page, backend }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: 'Not available for your role' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/dashboard');
        expect(backend.requests.filter((r) => r.path === '/webhooks' || r.path.startsWith('/audit/')).map((r) => r.path)).toEqual([]);
        await expectAccessible(page, 'main > .p-6');
      });
    }

    for (const [path, title] of CREATE_PAGES) {
      test(`opening ${path} by its address says it is not for this role, and shows no form`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: 'Not available for your role' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/dashboard');
        await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
      });
    }
  });
}

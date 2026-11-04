// Profiles by role: everyone sees them; an owner or admin adds, connects and disconnects them.
import { test, expect, get, ME } from './support/fixtures';
import type { Page } from '@playwright/test';

/** `GET /statistics/dashboard`: the overview reads every one of these. */
const STATS = { profiles: { total: 1, connected: 1 }, messages: { total: 0, today: 0 }, contacts: { total: 0 }, broadcasts: { total: 0 } };
const quickActions = (page: Page) => page.getByRole('region', { name: 'Quick actions' });

test('an admin is offered to add a profile and to disconnect one', async ({ page }) => {
  await page.goto('/dashboard/profiles');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add Profile' })).toBeVisible();
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('sees the profiles, with no Add Profile, Connect or Disconnect', async ({ page }) => {
      await page.goto('/dashboard/profiles');
      await expect(page.getByRole('button', { name: 'View Line 1 details' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add Profile' })).toHaveCount(0);
      for (const name of ['Connect', 'Disconnect', 'Cancel']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    });

    test('with no profile yet, is told an owner or admin connects one', async ({ page, backend }) => {
      backend.route(get('/profiles', []));
      await page.goto('/dashboard/profiles');
      await expect(page.getByText('An owner or admin connects the WhatsApp devices.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add Profile' })).toHaveCount(0);
    });

    test('the overview offers no profile or broadcast action', async ({ page, backend }) => {
      backend.route(get('/statistics/dashboard', STATS));
      await page.goto('/dashboard');
      await expect(page.getByRole('button', { name: 'View Line 1 details' })).toBeVisible();
      await expect(quickActions(page).getByRole('link', { name: /API docs/ })).toBeVisible();
      for (const name of [/Add profile/, /Create broadcast/]) await expect(quickActions(page).getByRole('link', { name })).toHaveCount(0);
      await expect(quickActions(page).getByRole('link', { name: /Send message/ })).toHaveCount(role === 'member' ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    });
  });
}

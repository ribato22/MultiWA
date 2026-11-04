// Which dashboard pages each role gets: every read of Webhooks and Audit is an owner's or admin's.
import { test, expect, ME } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const sidebarLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name, exact: true });

test('an admin has Webhooks and Audit in the sidebar', async ({ page }) => {
  await page.goto('/dashboard/api-keys');
  await expect(sidebarLink(page, 'Webhooks')).toBeVisible();
  await expect(sidebarLink(page, 'Audit')).toBeVisible();
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
        await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/dashboard');
        expect(backend.requests.filter((r) => r.path === '/webhooks' || r.path.startsWith('/audit/')).map((r) => r.path)).toEqual([]);
        await expectAccessible(page, 'main > .p-6');
      });
    }
  });
}

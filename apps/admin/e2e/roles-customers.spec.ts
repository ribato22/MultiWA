// The customers by role where the page specs leave a gap: the owner, an admin's class, and a role lowered since
// sign-in, which reaches the panel without signing out.
import { test, expect, gate, get, on, ME } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { CONFIG, customerBackend, openContactInfo } from './support/customers';
import type { Page } from '@playwright/test';

const sidebarLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name, exact: true });

test.describe('the owner', () => {
  test.use({ user: { ...ME, role: 'owner' } });

  test('works the chat panel, and changes another’s note', async ({ page, backend }) => {
    customerBackend(backend);
    const panel = await openContactInfo(page, backend);
    await expect(panel.getByRole('textbox', { name: 'New ID Pelanggan' })).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'New note' })).toBeVisible();
    const theirs = panel.getByRole('list', { name: 'Notes' }).getByRole('listitem').filter({ hasText: 'Mia Member' });
    for (const name of ['Edit note', 'Delete note']) await expect(theirs.getByRole('button', { name })).toBeVisible();
  });

  test('finds a customer from the sidebar, and may unlink its number and delete it', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(get('/customers', {
      items: [{ id: 'cus-1', externalId: '1234567890', displayName: 'Budi Santoso', linkCount: 1, noteCount: 2, lastActivityAt: null }],
      total: 1, page: 1, pageSize: 25,
    }));
    await page.goto('/dashboard/settings');
    await sidebarLink(page, 'Customers').click();
    await page.getByRole('link', { name: '1234567890' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Budi Santoso' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlink +6281100000001' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete customer' })).toBeVisible();
  });

  test('has every customer settings control, enabled', async ({ page, backend }) => {
    backend.route(get('/customers/config', CONFIG));
    await page.goto('/dashboard/settings?tab=customers');
    const form = page.getByRole('tabpanel');
    for (const label of ['ID label', 'Lookup URL', 'Timeout (ms)']) await expect(form.getByLabel(label)).toBeEnabled();
    for (const name of ['Save', 'Test', 'Replace', 'Clear']) await expect(form.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(form.getByText('Your role can read these settings but not change them.')).toHaveCount(0);
  });
});

test.describe('a member made a viewer since signing in', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('loses the panel’s controls once the server says so, without signing out', async ({ page, backend }) => {
    const told = gate();
    backend.route(on('GET', '/auth/me', async () => {
      await told.passed;
      return { json: { ...ME, role: 'viewer' } };
    }));
    customerBackend(backend);
    const panel = await openContactInfo(page, backend);
    await expect(panel.getByRole('textbox', { name: 'New ID Pelanggan' })).toBeVisible();
    told.open();
    // The page mounts afresh as the new role: Contact Info closes, and opens again without the controls.
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Contact Info', exact: true }).click();
    await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    for (const name of ['Edit note', 'Delete note', 'Add tag']) await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/chat/);
    await expectAccessible(page, 'section[aria-labelledby]');
  });
});

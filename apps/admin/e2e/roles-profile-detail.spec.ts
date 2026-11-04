// A profile's page by role: everyone reads it; an owner or admin connects it, changes its guardrails or deletes it.
import { test, expect, get, requestEnded, ME, PROFILE } from './support/fixtures';

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test("reads a profile's guardrails but cannot change them, disconnect or delete the profile", async ({ page }) => {
      await page.goto('/dashboard/profiles/p-1');
      const guardrails = page.getByRole('region', { name: 'Sending guardrails' });
      await expect(guardrails.getByLabel('Daily message limit')).toHaveValue('1000');
      await expect(guardrails.getByLabel('Daily message limit')).toBeDisabled();
      await expect(guardrails.getByRole('combobox', { name: 'Inter-message delay' })).toBeDisabled();
      await expect(guardrails.getByRole('switch', { name: 'Auto-reject incoming calls' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Save guardrails' })).toHaveCount(0);
      const actions = page.getByRole('region', { name: 'Profile actions' });
      await expect(actions.getByRole('link', { name: 'Open Chat' })).toBeVisible();
      for (const name of ['Disconnect', 'Delete profile']) await expect(actions.getByRole('button', { name, exact: true })).toHaveCount(0);
    });

    test('a link to connect a disconnected profile starts nothing, and offers no Connect', async ({ page, backend }) => {
      backend.route(get('/accounts/acc-1/profiles/p-1', { ...PROFILE, status: 'disconnected' }));
      const loaded = requestEnded(page, '/accounts/acc-1/profiles/p-1');
      await page.goto('/dashboard/profiles/p-1?action=connect');
      await loaded;
      await expect(page.getByRole('heading', { name: 'Line 1', exact: true })).toBeVisible();
      await page.waitForTimeout(500); // a connect would be out by now
      expect(backend.requests.filter((r) => r.path.endsWith('/connect')).map((r) => r.path)).toEqual([]);
      await expect(page.getByRole('button', { name: 'Connect WhatsApp' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Profile actions' })).toHaveCount(0);
    });
  });
}

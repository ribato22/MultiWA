// Broadcast and automation by role: configuration, so an owner or admin changes it and the others read it. The
// integrations are the server owner's alone: their settings come from the server's environment.
import { test, expect, get, ME } from './support/fixtures';
import type { Page } from '@playwright/test';

const sidebarLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name, exact: true });

const broadcast = (id: string, name: string, status: string) =>
  ({ id, profileId: 'p-1', name, status, recipients: { value: ['628111000111'] }, message: { type: 'text', text: 'Hi' }, createdAt: '2026-10-01T03:00:00.000Z' });
const BROADCASTS = [broadcast('b-1', 'October promo', 'draft'), broadcast('b-2', 'September promo', 'completed')];
const BROADCAST_CONTROLS = ['New Broadcast', 'Send this broadcast now', 'Resend this broadcast', 'Delete broadcast October promo'];
const AUTOMATION = {
  id: 'a-1', profileId: 'p-1', name: 'Greeting', isActive: true, triggerType: 'keyword', triggerConfig: { keywords: ['hi'] },
  actions: [{ type: 'reply', config: { message: 'Hello' } }], createdAt: '2026-10-01T03:00:00.000Z',
};
const INTEGRATIONS = { typebot: { apiUrl: 'https://typebot.example.com', defaultBotId: 'bot-1', enabled: true } };

test('an admin has the broadcast and automation controls', async ({ page, backend }) => {
  backend.route(get('/broadcast', BROADCASTS));
  backend.route(get('/automation', [AUTOMATION]));
  await page.goto('/dashboard/broadcast');
  for (const name of BROADCAST_CONTROLS) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.goto('/dashboard/automation');
  await expect(page.getByRole('switch', { name: 'Toggle Greeting' })).toBeEnabled();
  for (const name of ['Create Automation', 'Edit', 'Delete Greeting']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('reads the broadcasts but cannot create, send, resend or delete one', async ({ page, backend }) => {
      backend.route(get('/broadcast', BROADCASTS));
      await page.goto('/dashboard/broadcast');
      await expect(page.getByText('October promo')).toBeVisible();
      for (const name of BROADCAST_CONTROLS) await expect(page.getByRole('button', { name })).toHaveCount(0);
    });

    test('with no profile, is not offered to connect one for broadcasts', async ({ page, backend }) => {
      backend.route(get('/profiles', []));
      await page.goto('/dashboard/broadcast');
      await expect(page.getByRole('heading', { name: 'No Connected Profiles' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Connect Profile' })).toHaveCount(0);
    });

    test('reads the automations but cannot create, build, switch, edit or delete one', async ({ page, backend }) => {
      backend.route(get('/automation', [AUTOMATION]));
      await page.goto('/dashboard/automation');
      await expect(page.getByRole('heading', { name: 'Greeting' })).toBeVisible();
      await expect(page.getByText('Visual Builder')).toHaveCount(0);
      await expect(page.getByRole('switch', { name: 'Toggle Greeting' })).toHaveCount(0);
      for (const name of ['Create Automation', 'Edit', 'Delete Greeting']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    });

    test('with no automation yet, is not offered to create the first one', async ({ page, backend }) => {
      backend.route(get('/automation', []));
      await page.goto('/dashboard/automation');
      await expect(page.getByRole('heading', { name: 'No Automations Yet' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create Your First Automation' })).toHaveCount(0);
    });
  });
}

test.describe('the server owner', () => {
  test.use({ user: { ...ME, role: 'owner', isServerOwner: true } });

  test('has the integrations, enabled, with Save and Test', async ({ page, backend }) => {
    backend.route(get('/integrations/config', INTEGRATIONS));
    await page.goto('/dashboard/integrations');
    await expect(page.getByLabel('API URL')).toBeEnabled();
    await expect(page.getByRole('switch', { name: 'Toggle Enable TypeBot Integration' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Test Connection' })).toBeEnabled();
    await expect(sidebarLink(page, 'Integrations')).toBeVisible();
  });
});

for (const [who, user] of [['an admin who is not the server owner', ME], ['a member', { ...ME, role: 'member' }]] as const) {
  test.describe(who, () => {
    test.use({ user });

    test('has no Integrations link, and opening them by their address says they are not for this role and reads nothing', async ({ page, backend }) => {
      await page.goto('/dashboard/integrations');
      await expect(page.getByRole('heading', { level: 1, name: 'Not available for your role' })).toBeVisible();
      await expect(page.getByText('Only the server owner can open this page.')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to the overview' })).toHaveAttribute('href', '/dashboard');
      await expect(sidebarLink(page, 'Chat')).toBeVisible();
      await expect(sidebarLink(page, 'Integrations')).toHaveCount(0);
      expect(backend.requests.filter((r) => r.path === '/integrations/config').map((r) => r.path)).toEqual([]);
    });
  });
}

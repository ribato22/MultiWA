// Settings by role: the team under the team rules, and the server-wide settings for the server owner.
import { test, expect, gate, get, on, rendered, toasts, ME, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const person = (id: string, name: string, role: string) =>
  ({ id, name, email: `${id}@example.com`, role, isActive: true, lastLoginAt: null, createdAt: '2026-10-01T03:00:00.000Z' });
const OWNER = person('u-olga', 'Olga Owner', 'owner');
const ADMIN = person('u-adam', 'Adam Admin', 'admin');
const MEMBER = person('u-mia', 'Mia Member', 'member');
const VIEWER = person('u-vic', 'Vic Viewer', 'viewer');
const roleOf = (page: Page, name: string) => page.getByRole('combobox', { name: `Role of ${name}` });
const removeOf = (page: Page, name: string) => page.getByRole('button', { name: `Remove ${name}` });
/** The JSON body of the first `method path` request the pages sent, if one was sent. */
const sentBody = (backend: FakeBackend, method: string, path: string) => {
  const req = backend.requests.find((r) => r.method === method && r.path === path);
  return req?.body ? JSON.parse(req.body.toString()) : undefined;
};

test.describe('an admin', () => {
  test('manages the members and viewers: not the owner, another admin, nor their own row', async ({ page, backend }) => {
    backend.route(get('/organizations/members', [OWNER, person(ME.id, ME.name, 'admin'), ADMIN, MEMBER, VIEWER]));
    await page.goto('/dashboard/settings?tab=team');
    await expect(removeOf(page, VIEWER.name)).toBeVisible();
    await expect(removeOf(page, MEMBER.name)).toBeVisible();
    for (const name of [OWNER.name, ME.name, ADMIN.name]) {
      await expect(roleOf(page, name)).toHaveCount(0);
      await expect(removeOf(page, name)).toHaveCount(0);
    }
    await expectAccessible(page, '[role="tabpanel"]');
    await roleOf(page, MEMBER.name).click();
    await expect(page.getByRole('option')).toHaveText(['Member', 'Viewer']); // making an admin is the owner's
    await page.getByRole('option', { name: 'Viewer' }).click();
    await expect.poll(() => sentBody(backend, 'PUT', '/organizations/members/u-mia/role')).toEqual({ role: 'viewer' });
    await expect(roleOf(page, MEMBER.name)).toHaveText('Viewer');
  });

  test('invites a member or a viewer, not an admin', async ({ page }) => {
    await page.goto('/dashboard/settings?tab=team');
    await page.getByRole('button', { name: '+ Invite Member' }).click();
    await page.getByRole('dialog', { name: 'Invite Team Member' }).getByRole('combobox', { name: 'Role' }).click();
    await expect(page.getByRole('option')).toHaveText(['Member', 'Viewer']);
  });

  test('a change the server refuses says why, and the role stays as it was', async ({ page, backend }) => {
    backend.route(get('/organizations/members', [person(ME.id, ME.name, 'admin'), MEMBER]));
    backend.route(on('PUT', '/organizations/members/u-mia/role', { status: 403, json: { message: 'An admin manages members and viewers only' } }));
    await page.goto('/dashboard/settings?tab=team');
    await roleOf(page, MEMBER.name).click();
    await page.getByRole('option', { name: 'Viewer' }).click();
    await expect(toasts(page).getByText('An admin manages members and viewers only')).toBeVisible();
    await expect(roleOf(page, MEMBER.name)).toHaveText('Member');
  });
});

test.describe('the owner', () => {
  test.use({ user: { ...ME, role: 'owner' } });

  test('manages the admins too, and can make someone an admin', async ({ page, backend }) => {
    backend.route(get('/organizations/members', [person(ME.id, ME.name, 'owner'), ADMIN, MEMBER]));
    await page.goto('/dashboard/settings?tab=team');
    await expect(removeOf(page, ADMIN.name)).toBeVisible();
    await expect(roleOf(page, ME.name)).toHaveCount(0); // the owner's own row
    await roleOf(page, ADMIN.name).click();
    await expect(page.getByRole('option')).toHaveText(['Admin', 'Member', 'Viewer']);
  });
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('sees the team but cannot invite, change or remove anyone', async ({ page, backend }) => {
      backend.route(get('/organizations/members', [OWNER, ADMIN, MEMBER, VIEWER]));
      await page.goto('/dashboard/settings?tab=team');
      const panel = page.getByRole('tabpanel');
      await expect(panel).toContainText(VIEWER.name);
      await expect(page.getByRole('button', { name: '+ Invite Member' })).toHaveCount(0);
      await expect(panel.getByRole('combobox')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    });
  });
}

test.describe('the server owner', () => {
  test.use({ user: { ...ME, role: 'owner', isServerOwner: true } });

  test('has the Storage tab and the SMTP settings, as the server stores them', async ({ page, backend }) => {
    backend.route(get('/settings/storage', { type: 'local', source: 'database' }));
    backend.route(get('/settings/smtp', { host: 'smtp.example.com', port: 587, user: '', pass: '', from: 'noreply@example.com', secure: false, source: 'database' }));
    await page.goto('/dashboard/settings?tab=storage');
    await expect(tab(page, 'Storage')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('values stored in database');
    await tab(page, 'Notifications').click();
    await expect(page.getByRole('heading', { name: 'Email Server (SMTP)' })).toBeVisible();
    await expect(page.getByPlaceholder('smtp.gmail.com')).toHaveValue('smtp.example.com');
  });

  test('cannot save the storage settings before they are read: a Save then would write the defaults over them', async ({ page, backend }) => {
    const slow = gate();
    backend.route(on('GET', '/settings/storage', async () => {
      await slow.passed;
      return { json: { type: 's3', s3Endpoint: 'https://s3.example.net', s3Bucket: 'uploads', source: 'database' } };
    }));
    await page.goto('/dashboard/settings?tab=storage');
    await expect.poll(() => backend.requests.some((r) => r.path === '/settings/storage')).toBe(true); // `/auth/me` answered
    await rendered(page);
    const save = page.getByRole('button', { name: 'Save Configuration' });
    await expect(save).toHaveCount(0);
    slow.open();
    await expect(save).toBeEnabled();
    await expect(page.getByPlaceholder('https://minio.example.com')).toHaveValue('https://s3.example.net'); // the stored S3, not the default local
  });
});

test('an admin who is not the server owner has no Storage tab nor SMTP settings, and never reads them', async ({ page, backend }) => {
  await page.goto('/dashboard/settings?tab=storage'); // a link to the tab opens Account
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=account$/);
  await expect(tab(page, 'Storage')).toHaveCount(0);
  await tab(page, 'Notifications').click();
  await expect(page.getByRole('tabpanel')).toContainText('Notification Preferences');
  await expect(page.getByRole('heading', { name: 'Email Server (SMTP)' })).toHaveCount(0);
  expect(backend.requests.filter((r) => r.path.startsWith('/settings/')).map((r) => r.path)).toEqual([]);
});

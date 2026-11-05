// Settings → Customers: an owner or admin sets the lookup (the ID's name, the URL, the secret, the timeout) and tests
// it; a member and a viewer read it. The secret is never shown, only whether there is one.
import { test, expect, gate, get, on, toasts, ME, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { CONFIG, LOOKUP_OK, MANUAL, lookupAnswer } from './support/customers';
import type { Page } from '@playwright/test';

const tab = (page: Page) => page.getByRole('tab', { name: 'Customers', exact: true });
const panel = (page: Page) => page.getByRole('tabpanel');
/** The bodies of the settings saves, oldest first. */
const saves = (backend: FakeBackend) =>
  backend.requests.filter((r) => r.method === 'PUT' && r.path === '/customers/config').map((r) => JSON.parse(String(r.body)));
/** A server that takes a save, and answers the settings as they are then (never the secret). */
const takesSaves = (backend: FakeBackend) =>
  backend.route(on('PUT', '/customers/config', (r) => {
    const { secret, ...rest } = JSON.parse(String(r.body));
    return { json: { ...CONFIG, ...rest, hasSecret: secret === undefined ? CONFIG.hasSecret : secret !== '' } };
  }));

test('an admin opens the tab from its link, changes the ID’s name and the timeout, replaces the secret and saves', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  takesSaves(backend);
  await page.goto('/dashboard/settings?tab=customers');
  await expect(tab(page)).toHaveAttribute('aria-selected', 'true');
  const form = panel(page);
  await expect(form.getByLabel('ID label')).toHaveValue('ID Pelanggan');
  await expect(form.getByLabel('Lookup URL')).toHaveValue('https://crm.example.com/lookup');
  await expect(form.getByLabel('Timeout (ms)')).toHaveValue('5000');
  await expect(form.getByText('Set', { exact: true })).toBeVisible();
  await expect(form.getByLabel('New secret')).toHaveCount(0);
  await expectAccessible(page, '[role="tabpanel"]');
  await form.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(form.getByLabel('New secret')).toHaveValue(''); // never filled in
  await form.getByLabel('New secret').fill('fake-lookup-token');
  await form.getByLabel('ID label').fill('Nomor Pelanggan');
  await form.getByLabel('Timeout (ms)').fill('8000');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toasts(page).getByText('Customer settings saved')).toBeVisible();
  expect(saves(backend)).toEqual([{ idLabel: 'Nomor Pelanggan', lookupUrl: 'https://crm.example.com/lookup', timeoutMs: 8000, secret: 'fake-lookup-token' }]);
  await expect(form.getByLabel('New secret')).toHaveCount(0);
  await expect(form.getByText('Set', { exact: true })).toBeVisible();
});

test('a save that leaves the secret alone keeps it; Clear takes it away on the next save', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  takesSaves(backend);
  await page.goto('/dashboard/settings?tab=customers');
  const form = panel(page);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toasts(page).getByText('Customer settings saved')).toBeVisible();
  await form.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(form.getByText('The secret is removed when you save.')).toBeVisible();
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByText('Not set', { exact: true })).toBeVisible();
  const kept = { idLabel: 'ID Pelanggan', lookupUrl: 'https://crm.example.com/lookup', timeoutMs: 5000 };
  expect(saves(backend)).toEqual([kept, { ...kept, secret: '' }]);
});

test('a Replace saved with its new secret left empty keeps the stored secret: no secret is sent', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  takesSaves(backend);
  await page.goto('/dashboard/settings?tab=customers');
  const form = panel(page);
  await form.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(form.getByLabel('New secret')).toHaveValue('');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toasts(page).getByText('Customer settings saved')).toBeVisible();
  expect(saves(backend)).toEqual([{ idLabel: 'ID Pelanggan', lookupUrl: 'https://crm.example.com/lookup', timeoutMs: 5000 }]);
  await expect(form.getByText('Set', { exact: true })).toBeVisible();
});

test('the focus follows the secret’s controls: into the new secret, and back to Replace or Clear when Cancel closes it', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  await page.goto('/dashboard/settings?tab=customers');
  const form = panel(page);
  const button = (name: string) => form.getByRole('button', { name, exact: true });
  await button('Replace').click();
  await expect(form.getByLabel('New secret')).toBeFocused();
  await button('Cancel').click();
  await expect(button('Replace')).toBeFocused();
  await button('Clear').click();
  await expect(button('Cancel')).toBeFocused();
  await button('Cancel').click();
  await expect(button('Clear')).toBeFocused();
});

test('cannot save the settings before they are read: a Save then would write the defaults over them', async ({ page, backend }) => {
  const slow = gate();
  backend.route(on('GET', '/customers/config', async () => {
    await slow.passed;
    return { json: CONFIG };
  }));
  await page.goto('/dashboard/settings?tab=customers');
  await expect.poll(() => backend.requests.some((r) => r.path === '/customers/config')).toBe(true);
  await expect(panel(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  slow.open();
  await expect(panel(page).getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(panel(page).getByLabel('Lookup URL')).toHaveValue('https://crm.example.com/lookup');
});

test('a lookup URL the server refuses says why, and nothing says it saved', async ({ page, backend }) => {
  backend.route(get('/customers/config', MANUAL));
  backend.route(on('PUT', '/customers/config', { status: 400, json: { statusCode: 400, message: 'Webhook target address is not allowed', error: 'Bad Request' } }));
  await page.goto('/dashboard/settings?tab=customers');
  const form = panel(page);
  await form.getByLabel('Lookup URL').fill('http://10.0.0.5/lookup');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toasts(page).getByText('Webhook target address is not allowed')).toBeVisible();
  await expect(toasts(page).getByText('Customer settings saved')).toHaveCount(0);
  await expect(form.getByLabel('Lookup URL')).toHaveValue('http://10.0.0.5/lookup');
});

test('Test asks the saved lookup about an ID, and says what came back and how fast', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  const answers: Record<string, object> = {
    '1234567890': { ...LOOKUP_OK, latencyMs: 230 },
    '1111111111': { ...lookupAnswer('not_found'), latencyMs: 120 },
    '2222222222': { ...lookupAnswer('unavailable'), latencyMs: 5003 },
    '3333333333': { ...lookupAnswer('not_configured'), latencyMs: 0 },
  };
  backend.route(on('POST', '/customers/config/test', (r) => ({ json: answers[JSON.parse(String(r.body)).externalId] })));
  await page.goto('/dashboard/settings?tab=customers');
  const form = panel(page);
  const id = form.getByLabel('ID Pelanggan to test');
  for (const [externalId, said] of [
    ['1234567890', 'Found: Budi Santoso (230 ms)'],
    ['1111111111', 'Not found (120 ms)'],
    ['2222222222', 'Unavailable (5003 ms)'],
    ['3333333333', 'No lookup URL is saved'],
  ]) {
    await id.fill(externalId);
    await form.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(id).toHaveAccessibleDescription(said);
  }
  expect(backend.requests.filter((r) => r.path === '/customers/config/test').map((r) => JSON.parse(String(r.body)))).toEqual([
    { externalId: '1234567890' }, { externalId: '1111111111' }, { externalId: '2222222222' }, { externalId: '3333333333' },
  ]);
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('reads the customer settings but cannot change, save or test them', async ({ page, backend }) => {
      backend.route(get('/customers/config', CONFIG));
      await page.goto('/dashboard/settings?tab=customers');
      const form = panel(page);
      await expect(form.getByText('Your role can read these settings but not change them.')).toBeVisible();
      await expect(form.getByLabel('ID label')).toHaveValue('ID Pelanggan');
      for (const label of ['ID label', 'Lookup URL', 'Timeout (ms)']) await expect(form.getByLabel(label)).toBeDisabled();
      await expect(form.getByText('Set', { exact: true })).toBeVisible();
      for (const name of ['Save', 'Test', 'Replace', 'Clear']) await expect(form.getByRole('button', { name, exact: true })).toHaveCount(0);
      await expect(form.getByLabel('ID Pelanggan to test')).toHaveCount(0);
      await expectAccessible(page, '[role="tabpanel"]');
    });
  });
}

// The Customers pages: the list, searched and paged by the server, and a customer's page with its numbers, its
// details, its tags and notes, and the chats and calls of its numbers. Every role reads them; an agent unlinks a
// number; an owner or admin deletes a customer.
import { test, expect, get, on, toasts, ME, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { CONFIG, PHONE, customerBackend, openContactInfo } from './support/customers';
import type { Page } from '@playwright/test';

const BUDI = { id: 'cus-1', externalId: '1234567890', displayName: 'Budi Santoso', linkCount: 2, noteCount: 3, lastActivityAt: '2026-11-01T03:00:00.000Z' };
const UNNAMED = { id: 'cus-2', externalId: '9876543210', displayName: null, linkCount: 1, noteCount: 0, lastActivityAt: null };
/** The list as the server pages it: `items` on every page, `total` customers in all. */
const listing = (items: object[], total = items.length) =>
  on('GET', '/customers', (r) => ({ json: { items, total, page: Number(r.query.get('page')), pageSize: Number(r.query.get('pageSize')) } }));
/** The queries of the list reads, oldest first. */
const asked = (backend: FakeBackend) => backend.requests.filter((r) => r.path === '/customers').map((r) => r.query.toString());
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search customers' });

const LINE_2 = { ...PROFILE, id: 'p-2', name: 'Line 2', displayName: 'Line 2' };
const HISTORY = [
  { kind: 'call', id: 'call-1', profileId: LINE_2.id, profileName: 'Line 2', phone: PHONE, at: '2026-11-03T03:00:00.000Z', summary: 'Missed voice call' },
  { kind: 'conversation', id: 'conv-1', profileId: PROFILE.id, profileName: 'Line 1', phone: PHONE, at: '2026-11-02T03:00:00.000Z', summary: 'Terima kasih, sudah lunas' },
];
/** Budi Santoso's page: the customer, its lookup and its history. */
function customerPage(backend: FakeBackend) {
  customerBackend(backend);
  backend.route(get('/customers/cus-1/history', HISTORY));
}
const numbers = (page: Page) => page.getByRole('region', { name: 'Numbers' });
const historyOf = (page: Page) => page.getByRole('region', { name: 'History' });

test('the list names the ID as the organization does, with the name, numbers, last activity and notes; an ID opens its customer', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  backend.route(listing([BUDI, UNNAMED]));
  await page.goto('/dashboard/customers');
  await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText(['ID Pelanggan', 'Name', 'Numbers', 'Last activity', 'Notes']);
  const rows = page.getByRole('row');
  await expect(rows.nth(1).getByRole('cell')).toHaveText(['1234567890', 'Budi Santoso', '2', /01 Nov 2026/, '3']);
  await expect(rows.nth(2).getByRole('cell')).toHaveText(['9876543210', '—', '1', '—', '0']);
  await expect(page.getByRole('link', { name: '1234567890' })).toHaveAttribute('href', '/dashboard/customers/cus-1');
  expect(asked(backend)).toEqual(['page=1&pageSize=25']);
  await expectAccessible(page, 'main > .p-6');
});

test('a search asks the server, and one that matches nothing says so', async ({ page, backend }) => {
  backend.route(on('GET', '/customers', (r) => ({ json: { items: r.query.get('q') ? [] : [BUDI], total: r.query.get('q') ? 0 : 1, page: 1, pageSize: 25 } })));
  await page.goto('/dashboard/customers');
  await expect(page.getByRole('link', { name: '1234567890' })).toBeVisible();
  await searchBox(page).fill('siti');
  await expect(page.getByRole('heading', { name: 'No customers match your search' })).toBeVisible();
  expect(asked(backend)).toEqual(['page=1&pageSize=25', 'q=siti&page=1&pageSize=25']);
});

test('Previous and Next ask for the pages and say where they are; a search starts again from the first', async ({ page, backend }) => {
  backend.route(listing([BUDI], 30));
  await page.goto('/dashboard/customers');
  const pages = page.getByRole('navigation', { name: 'Pages' });
  await expect(pages).toContainText('Page 1 of 2');
  await expect(pages.getByRole('button', { name: 'Previous' })).toBeDisabled();
  await pages.getByRole('button', { name: 'Next' }).click();
  await expect(pages).toContainText('Page 2 of 2');
  await expect(pages.getByRole('button', { name: 'Next' })).toBeDisabled();
  await searchBox(page).fill('budi');
  await expect(pages).toContainText('Page 1 of 2');
  await expect.poll(() => asked(backend)).toEqual(['page=1&pageSize=25', 'page=2&pageSize=25', 'q=budi&page=1&pageSize=25']);
});

test('with no customer yet, the list says how one comes', async ({ page, backend }) => {
  backend.route(get('/customers/config', CONFIG));
  backend.route(listing([]));
  await page.goto('/dashboard/customers');
  await expect(page.getByRole('heading', { name: 'No customers yet' })).toBeVisible();
  await expect(page.getByText("Customers appear here once their ID Pelanggan is linked to a WhatsApp number, from a chat's Contact Info or through the API.")).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('a list the server cannot give says so', async ({ page, backend }) => {
  backend.route(on('GET', '/customers', { status: 500, json: { message: 'Internal server error' } }));
  await page.goto('/dashboard/customers');
  await expect(toasts(page).getByText('Could not load the customers')).toBeVisible();
});

test('a customer’s page has its numbers, its lookup, its tags and notes, and a history that opens the chat and the calls', async ({ page, backend }) => {
  customerPage(backend);
  await page.goto('/dashboard/customers/cus-1');
  await expect(page.getByRole('heading', { level: 1, name: 'Budi Santoso' })).toBeVisible();
  await expect(page.getByText('ID Pelanggan 1234567890')).toBeVisible();
  await expect(page.getByRole('link', { name: 'All customers' })).toHaveAttribute('href', '/dashboard/customers');
  await expect(numbers(page).getByRole('listitem')).toHaveCount(1);
  await expect(numbers(page)).toContainText('+6281100000001');
  await expect(numbers(page)).toContainText('by Mia Member');
  await expect(page.getByText('R1 / 1300 VA')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Customer tags' })).toHaveText('priority');
  await expect(page.getByRole('heading', { level: 2, name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Notes' }).getByRole('listitem')).toHaveCount(2);
  await expect(historyOf(page).getByRole('link', { name: /Missed voice call/ })).toHaveAttribute('href', '/dashboard/calls?profile=p-2');
  await expect(historyOf(page).getByRole('link', { name: /Terima kasih, sudah lunas/ })).toHaveAttribute('href', '/dashboard/chat?profile=p-1&conv=conv-1');
  expect(backend.requests.find((r) => r.path === '/customers/cus-1/history')?.query.get('limit')).toBe('50');
  await expectAccessible(page, 'main > .p-6');
});

test('a call in the history opens the Calls of its profile', async ({ page, backend }) => {
  customerPage(backend);
  backend.route(get('/profiles', [PROFILE, LINE_2]));
  const profilesAsked = () => backend.requests.filter((r) => r.path === '/calls').map((r) => r.query.get('profileId'));
  await page.goto('/dashboard/customers/cus-1');
  await historyOf(page).getByRole('link', { name: /Missed voice call/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/calls\?profile=p-2$/);
  await expect(page.getByRole('combobox', { name: 'Profile' })).toHaveText('Line 2');
  await expect.poll(profilesAsked).toContain(LINE_2.id);
  expect(profilesAsked()).not.toContain(PROFILE.id);
});

test('the chat’s customer panel opens the customer’s page', async ({ page, backend }) => {
  customerPage(backend);
  const panel = await openContactInfo(page, backend);
  await panel.getByRole('link', { name: 'Open the customer page' }).click();
  await expect(page).toHaveURL(/\/dashboard\/customers\/cus-1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Budi Santoso' })).toBeVisible();
});

test('an admin deletes the customer once they say yes, and is back on the list', async ({ page, backend }) => {
  customerPage(backend);
  backend.route(on('DELETE', '/customers/cus-1', { json: { success: true } }));
  await page.goto('/dashboard/customers/cus-1');
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Delete customer' }).click();
  expect(backend.requests.some((r) => r.method === 'DELETE')).toBe(false);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete customer' }).click();
  await expect(page).toHaveURL(/\/dashboard\/customers$/);
  await expect(toasts(page).getByText('Customer deleted')).toBeVisible();
});

test('a customer that is not there says so, with the way back to the list', async ({ page, backend }) => {
  backend.route(on('GET', '/customers/cus-9', { status: 404, json: { statusCode: 404, message: 'Customer not found', error: 'Not Found' } }));
  await page.goto('/dashboard/customers/cus-9');
  await expect(page.getByRole('heading', { level: 1, name: 'Customer not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All customers' })).toHaveAttribute('href', '/dashboard/customers');
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('unlinks a number and the customer stays; there is no Delete customer', async ({ page, backend }) => {
    customerPage(backend);
    backend.route(on('DELETE', '/customers/links/lnk-1', { json: { success: true } }));
    page.on('dialog', (d) => d.accept());
    await page.goto('/dashboard/customers/cus-1');
    await expect(page.getByRole('heading', { level: 1, name: 'Budi Santoso' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete customer' })).toHaveCount(0);
    await numbers(page).getByRole('button', { name: 'Unlink +6281100000001' }).click();
    await expect(numbers(page).getByText('No number is linked any more.')).toBeVisible();
    await expect(toasts(page).getByText('+6281100000001 unlinked')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/customers\/cus-1$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Budi Santoso' })).toBeVisible();
  });
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('reads a customer’s page, with no Unlink and no Delete customer', async ({ page, backend }) => {
    customerPage(backend);
    await page.goto('/dashboard/customers/cus-1');
    await expect(numbers(page)).toContainText('+6281100000001');
    await expect(page.getByText('R1 / 1300 VA')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Unlink / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete customer' })).toHaveCount(0);
    await expectAccessible(page, 'main > .p-6');
  });
});

const sidebarLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name, exact: true });

for (const role of ['viewer', 'member', 'admin']) {
  test.describe(`a ${role}, in the sidebar`, () => {
    test.use({ user: { ...ME, role } });

    test('has Customers, which opens the list', async ({ page, backend }) => {
      backend.route(listing([BUDI]));
      await page.goto('/dashboard/settings');
      await sidebarLink(page, 'Customers').click();
      await expect(page).toHaveURL(/\/dashboard\/customers$/);
      await expect(page.getByRole('link', { name: '1234567890' })).toBeVisible();
      await expect(sidebarLink(page, 'Customers')).toHaveAttribute('aria-current', 'page');
    });
  });
}

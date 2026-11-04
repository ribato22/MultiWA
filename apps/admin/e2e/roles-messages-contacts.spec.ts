// Messages and contacts by role: sending and adding a contact are an agent's, syncing and deleting an owner's or admin's.
import { test, expect, get, ME } from './support/fixtures';

const CONTACT = { id: 'ct-1', profileId: 'p-1', phone: '628111000111', name: 'Pak Joko', tags: ['vip'], createdAt: '2026-10-01T03:00:00.000Z' };
const CONTACTS = { contacts: [CONTACT], total: 1, limit: 50, offset: 0 };

test('an admin syncs and deletes contacts', async ({ page, backend }) => {
  backend.route(get('/contacts', CONTACTS));
  await page.goto('/dashboard/contacts');
  for (const name of ['Add Contact', 'Sync contacts from WhatsApp', 'Delete Pak Joko']) await expect(page.getByRole('button', { name })).toBeVisible();
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('sees what was sent, with no form to send', async ({ page }) => {
    await page.goto('/dashboard/messages');
    await expect(page.getByRole('heading', { name: 'Recent Sent' })).toBeVisible();
    await expect(page.getByText('Your role can see what was sent but not send messages.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send Message' })).toHaveCount(0);
  });

  test('reads the contacts but cannot add, message, sync or delete one', async ({ page, backend }) => {
    backend.route(get('/contacts', CONTACTS));
    await page.goto('/dashboard/contacts');
    await expect(page.getByRole('cell', { name: 'Pak Joko', exact: true })).toBeVisible();
    for (const name of ['Add Contact', 'Sync contacts from WhatsApp', 'Delete Pak Joko']) await expect(page.getByRole('button', { name })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Message Pak Joko' })).toHaveCount(0);
  });
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('sends messages, but is not offered to add a profile when there is none', async ({ page, backend }) => {
    await page.goto('/dashboard/messages');
    await expect(page.getByRole('heading', { name: 'Send Message' })).toBeVisible();
    backend.route(get('/profiles', []));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No Connected Profiles' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add Profile' })).toHaveCount(0);
  });

  test('adds and messages a contact, but cannot sync or delete one', async ({ page, backend }) => {
    backend.route(get('/contacts', CONTACTS));
    await page.goto('/dashboard/contacts');
    await expect(page.getByRole('cell', { name: 'Pak Joko', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Contact' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Message Pak Joko' })).toBeVisible();
    for (const name of ['Sync contacts from WhatsApp', 'Delete Pak Joko']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  });
});

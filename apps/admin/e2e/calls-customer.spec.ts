// The caller's customer in a call's detail: the same panel as a chat's Contact Info, for a one-to-one call's number.
import { test, expect, ME, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { PHONE, customerBackend } from './support/customers';
import type { Page } from '@playwright/test';

const CALL = {
  id: 'call-1', profileId: PROFILE.id, waCallId: 'W1', fromJid: `${PHONE}@s.whatsapp.net`, isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'missed', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:00:30.000Z',
  followUp: 'open', assignedUserId: null, conversationId: 'conv-1', answeredByUserId: null, answeredAt: null, endedBy: null,
  endReason: null, talkSeconds: null, assignedUser: null, answeredBy: null, conversation: { id: 'conv-1', name: 'Pak Budi' }, recording: null,
};
/** The Open tab lists `calls`; the ringing strip, which asks for `outcome=ringing`, none of them. */
const listCalls = (backend: FakeBackend, calls: object[]) =>
  backend.route((r) => (r.method === 'GET' && r.path === '/calls' ? { json: { calls: r.query.get('outcome') ? [] : calls, nextCursor: null } } : undefined));
const row = (page: Page) => page.getByRole('list', { name: 'Calls', exact: true }).getByRole('listitem').filter({ hasText: 'Pak Budi' });
const toggle = (page: Page) => row(page).getByRole('button', { name: 'Customer', exact: true });
const panelOf = (page: Page) => row(page).getByRole('region', { name: 'Customer', exact: true });

test('a one-to-one call opens its caller’s customer under its row, and closes it again', async ({ page, backend }) => {
  customerBackend(backend);
  listCalls(backend, [CALL]); // a missed call: the accessibility check below covers its Missed badge too
  await page.goto('/dashboard/calls');
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  const panel = panelOf(page);
  await expect(panel.getByRole('combobox', { name: 'ID Pelanggan' })).toHaveText('1234567890 · Budi Santoso');
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Contact tags' })).toHaveText('vip'); // the call's profile's contact
  const contacts = backend.requests.find((r) => r.path === '/contacts');
  expect([contacts?.query.get('profileId'), contacts?.query.get('search')]).toEqual([PROFILE.id, PHONE]);
  await expectAccessible(page, 'ul[aria-label="Calls"]');
  await toggle(page).click();
  await expect(panel).toHaveCount(0);
});

for (const [what, over] of [
  ['a group call', { isGroup: true, fromJid: '120363000000000001@g.us' }],
  ['a call from a number WhatsApp hides', { fromJid: '200000000000001@lid' }],
] as const) {
  test(`${what} has no customer to open`, async ({ page, backend }) => {
    listCalls(backend, [{ ...CALL, ...over }]);
    await page.goto('/dashboard/calls');
    await expect(row(page)).toContainText('Missed');
    await expect(toggle(page)).toHaveCount(0);
  });
}

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('opens the caller’s customer to read it, with nothing to link and no note to add', async ({ page, backend }) => {
    customerBackend(backend);
    listCalls(backend, [CALL]);
    await page.goto('/dashboard/calls');
    await toggle(page).click();
    await expect(panelOf(page).getByText('R1 / 1300 VA')).toBeVisible();
    await expect(panelOf(page).getByRole('textbox')).toHaveCount(0);
  });
});

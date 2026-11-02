import { test, expect, get, on, rendered, ME, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';

/** The JSON body of the first `method path` request the pages sent, if one was sent. */
const sentBody = (backend: FakeBackend, method: string, path: string) => {
  const req = backend.requests.find((r) => r.method === method && r.path === path);
  return req?.body ? JSON.parse(req.body.toString()) : undefined;
};

test('an API key can get the recordings scopes, and the keys list names its scopes', async ({ page, backend }) => {
  backend.route(get('/api-keys', [{ id: 'k1', name: 'Recorder', key: 'mwa_live_1234', permissions: ['recordings:read', 'recordings:delete'], createdAt: '2026-11-01T00:00:00.000Z' }]));
  backend.route(on('POST', '/api-keys', { json: { id: 'k2', key: 'mwa_live_5678' } }));
  await page.goto('/dashboard/api-keys');
  // The keys show as a table on a wide screen and as cards on a narrow one: the visible copy counts.
  await expect(page.getByText('Read Recordings', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create API Key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API Key' });
  await expect(dialog.getByText('Recordings', { exact: true })).toBeVisible();
  await dialog.getByLabel('Key Name').fill('Recorder 2');
  await dialog.getByLabel('Read Recordings', { exact: true }).check();
  await dialog.getByLabel('Delete Recordings', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Create Key' }).click();
  await expect(page.getByLabel('Generated API key')).toHaveValue('mwa_live_5678'); // the reply's key, shown once
  expect(sentBody(backend, 'POST', '/api-keys')?.permissions).toEqual(['recordings:read', 'recordings:delete']);
});

test('a call ringing on the calls page can be rejected with a red button whose text is readable (WCAG AA)', async ({ page, backend }) => {
  const call = {
    id: 'call-9', profileId: 'p-1', waCallId: 'W9', fromJid: '628111000999@s.whatsapp.net', isVideo: false, isGroup: false, direction: 'incoming',
    outcome: 'ringing', rejectedBy: null, startedAt: new Date().toISOString(), endedAt: null, followUp: 'open', assignedUserId: null,
    conversationId: null, conversation: null, assignedUser: null, answeredBy: null, recording: null,
  };
  backend.route(on('GET', '/calls', (req) => ({ json: { calls: req.query.get('outcome') === 'ringing' ? [call] : [], nextCursor: null } })));
  await page.goto('/dashboard/calls');
  const ringingNow = page.getByRole('region', { name: 'Ringing now' });
  await expect(ringingNow.getByRole('button', { name: 'Reject' })).toBeVisible();
  await expectAccessible(page, '[aria-label="Ringing now"]');
});

test('a webhook can subscribe to the answered call and the recording events', async ({ page, backend }) => {
  await page.goto('/dashboard/webhooks');
  await page.getByRole('button', { name: 'Add Webhook' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Webhook' });
  await dialog.getByLabel('Webhook URL').fill('https://example.com/hook');
  for (const name of ['Call Answered', 'Recording Ready', 'Recording Deleted']) await dialog.getByLabel(name, { exact: true }).check();
  await dialog.getByRole('button', { name: 'Add Webhook' }).click();
  await expect.poll(() => sentBody(backend, 'POST', '/webhooks')?.events).toEqual(['call.answered', 'call.recording.ready', 'call.recording.deleted']);
});

test('the bell shows a call alert, a call notice and other system alerts each with its icon', async ({ page, backend }) => {
  const at = '2026-11-01T03:00:00.000Z';
  backend.route(get('/notifications', {
    total: 5,
    notifications: [
      { id: 'n1', type: 'system', title: 'A recording failed', body: 'Line 1', metadata: { kind: 'call_recording_failed' }, isRead: true, createdAt: at },
      { id: 'n2', type: 'call', title: 'Missed call', body: 'From 628111000111', metadata: { callId: 'call-1' }, isRead: true, createdAt: at },
      { id: 'n3', type: 'system', title: 'Maintenance tonight', body: 'The server restarts at 22.00', isRead: true, createdAt: at },
      // A kind that only starts like a call alert's.
      { id: 'n4', type: 'system', title: 'Callback due', body: 'Ring Pak Joko back', metadata: { kind: 'callback_due' }, isRead: true, createdAt: at },
      // A call notice whose kind starts like a call alert's: only a system alert gets the alert icon.
      { id: 'n5', type: 'call', title: 'Call on line 2', body: 'Line 2', metadata: { kind: 'call_x' }, isRead: true, createdAt: at },
    ],
  }));
  await page.goto('/dashboard/api-keys');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const row = (title: string) => page.getByRole('dialog', { name: 'Notifications' }).getByRole('button').filter({ hasText: title });
  await expect(row('A recording failed').locator('svg.lucide-phone-off')).toBeVisible();
  await expect(row('Missed call').locator('svg.lucide-phone-missed')).toBeVisible();
  await expect(row('Maintenance tonight').locator('svg.lucide-wrench')).toBeVisible();
  await expect(row('Callback due').locator('svg.lucide-wrench')).toBeVisible();
  await expect(row('Call on line 2').locator('svg.lucide-phone-missed')).toBeVisible();
});

test('revoking an API key and deleting a webhook are confirmed with a red button whose text is readable (WCAG AA)', async ({ page, backend }) => {
  backend.route(get('/api-keys', [{ id: 'k1', name: 'Recorder', key: 'mwa_live_1234', permissions: ['recordings:read'], createdAt: '2026-11-01T00:00:00.000Z' }]));
  backend.route(get('/webhooks', [{ id: 'w1', profileId: 'p-1', url: 'https://example.com/hook', events: ['call.answered'], enabled: true, createdAt: '2026-11-01T00:00:00.000Z' }]));
  /** The confirmation is open and done fading in: axe reads the colours as they are. */
  const confirm = async (name: string, action: string) => {
    await expect(page.getByRole('alertdialog', { name }).getByRole('button', { name: action })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
    await expectAccessible(page, '[role="alertdialog"]');
  };
  await page.goto('/dashboard/api-keys');
  await page.getByRole('button', { name: 'Revoke', exact: true }).filter({ visible: true }).first().click();
  await confirm('Revoke API Key?', 'Revoke Key');
  await page.goto('/dashboard/webhooks');
  await page.getByRole('button', { name: 'Delete', exact: true }).filter({ visible: true }).first().click();
  await confirm('Delete Webhook?', 'Delete Webhook');
});

test("the header's menus close on Escape and once the focus leaves them: one opened from the keyboard is never left over the page", async ({ page }) => {
  await page.goto('/dashboard/api-keys');
  const account = page.getByRole('button', { name: 'Account menu' });
  const menu = page.getByRole('menu', { name: 'Account' });
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab'); // into the menu: Settings
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(account).toBeFocused(); // back where it opened
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  for (const _ of ['Settings', 'Sign out', 'out of the header']) await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  const notifications = page.getByRole('dialog', { name: 'Notifications' });
  await bell.focus();
  await page.keyboard.press('Enter');
  await expect(notifications).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notifications).toHaveCount(0);
  await expect(bell).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(notifications).toBeVisible();
  await page.keyboard.press('Shift+Tab'); // out, the other way
  await expect(notifications).toHaveCount(0);
});

test("a click on a header menu's own text leaves it open: the focus goes nowhere, not out of the menu", async ({ page }) => {
  await page.goto('/dashboard/api-keys');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  const notifications = page.getByRole('dialog', { name: 'Notifications' });
  await notifications.getByRole('heading', { name: 'Notifications' }).click();
  await rendered(page);
  await expect(notifications).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await menu.getByText(ME.email).click();
  await rendered(page);
  await expect(menu).toBeVisible();
});

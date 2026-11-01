import { test, expect, get } from './support/fixtures';

test('an API key can get the recordings scopes, and the keys list names its scopes', async ({ page, backend }) => {
  backend.route(get('/api-keys', [{ id: 'k1', name: 'Recorder', key: 'mwa_live_1234', permissions: ['recordings:read', 'recordings:delete'], createdAt: '2026-11-01T00:00:00.000Z' }]));
  await page.goto('/dashboard/api-keys');
  // The keys show as a table on a wide screen and as cards on a narrow one: the visible copy counts.
  await expect(page.getByText('Play recordings', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create API Key' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create API Key' });
  await expect(dialog.getByText('Recordings', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Play recordings')).toBeVisible();
  await expect(dialog.getByLabel('Delete recordings')).toBeVisible();
});

test('a webhook can subscribe to the answered call and the recording events', async ({ page }) => {
  await page.goto('/dashboard/webhooks');
  await page.getByRole('button', { name: 'Add Webhook' }).first().click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Call Answered', 'Recording Ready', 'Recording Deleted']) await expect(dialog.getByText(name, { exact: true })).toBeVisible();
});

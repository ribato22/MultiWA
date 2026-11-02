import { test, expect, get, on, ME, PROFILE, STATUS, type FakeBackend, type Reply } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { sineWav } from './support/audio';
import type { Page } from '@playwright/test';

const section = (page: Page) => page.getByRole('region', { name: 'Calls', exact: true });
const status = (profile: Partial<(typeof STATUS)['profiles'][number]>) => ({ ...STATUS, profiles: [{ ...STATUS.profiles[0], ...profile }] });
const puts = (backend: FakeBackend) =>
  backend.requests.filter((r) => r.method === 'PUT' && r.path === '/profiles/p-1/calls-settings').map((r) => JSON.parse(r.body!.toString()));
const settings = (over: Record<string, unknown> = {}) => ({ profileId: 'p-1', answerInDashboard: false, recording: false, retentionDays: 90, announcement: null, ...over });

test('the checklist says what answering in the dashboard still needs, and a refused switch shows the server’s reasons', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ ready: false, reasons: ['auto_reject_on', 'web_calling_disabled'] })));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', {
    status: 409,
    json: { message: 'Answering calls in the dashboard is not available for this profile', reasons: ['auto_reject_on', 'web_calling_disabled'] },
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Auto-reject is on for this profile: turn it off');
  await expect(s).toContainText('WhatsApp has not enabled calling on WhatsApp Web for this number');
  const answer = s.getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.click();
  const refusal = s.getByRole('alert');
  await expect(refusal).toContainText('Answering calls in the dashboard is not available for this profile');
  // The refusal lists the server's own reasons (the 409's body), not the checklist's.
  await expect(refusal.getByRole('listitem')).toHaveText(['Auto-reject is on for this profile: turn it off', 'WhatsApp has not enabled calling on WhatsApp Web for this number']);
  await expect(answer).toHaveAttribute('aria-checked', 'false');
  expect(puts(backend)).toEqual([{ answerInDashboard: true }]);
  await expectAccessible(page, '[aria-label="Calls"]');
});

test('auto-reject turned off in the guardrails, as the checklist asks, leaves the checklist ready', async ({ page, backend }) => {
  let autoReject = true;
  backend.route((r) => (r.method === 'GET' && r.path === '/calls/media/status' ? { json: autoReject ? status({ ready: false, reasons: ['auto_reject_on'] }) : STATUS } : undefined));
  backend.route((r) => (r.method === 'GET' && r.path === '/accounts/acc-1/profiles/p-1' ? { json: { ...PROFILE, settings: { ...PROFILE.settings, autoRejectCalls: autoReject } } } : undefined));
  backend.route(on('PUT', '/profiles/p-1', (r) => {
    autoReject = JSON.parse(r.body!.toString()).autoRejectCalls;
    return { json: {} };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Auto-reject is on for this profile: turn it off');
  await page.getByRole('switch', { name: 'Auto-reject incoming calls' }).click();
  await page.getByRole('button', { name: 'Save guardrails' }).click();
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s).not.toContainText('Auto-reject is on');
});

test('answering in the dashboard turns on for a profile that is ready', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { json: settings({ answerInDashboard: true }) }));
  await page.goto('/dashboard/profiles/p-1');
  const answer = section(page).getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.click();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
});

test('recording needs an announcement: an uploaded one shows, and recording refused for the storage says why', async ({ page, backend }) => {
  backend.route(on('POST', '/profiles/p-1/calls-announcement', { json: { profileId: 'p-1', announcement: { mimeType: 'audio/wav', durationSec: 2 } } }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { status: 409, json: { message: 'Recording calls is not available for this profile', reasons: ['storage_not_private'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const record = s.getByRole('switch', { name: 'Record calls' });
  await expect(record).toBeDisabled();
  await expect(s).toContainText('Upload an announcement first');
  await s.locator('input[type="file"]').setInputFiles({ name: 'notice.wav', mimeType: 'audio/wav', buffer: sineWav(2) });
  await expect(s).toContainText('wav · 2.0 s');
  const post = backend.requests.find((r) => r.method === 'POST' && r.path === '/profiles/p-1/calls-announcement')!;
  expect(post.headers['content-type']).toMatch(/^multipart\/form-data/);
  expect(post.body!.toString('latin1')).toContain('filename="notice.wav"');
  await record.click();
  await expect(s.getByRole('alert')).toContainText('The recording storage can be read without a login: ask your administrator to make it private');
  await expect(record).toHaveAttribute('aria-checked', 'false');
});

test('an announcement the server refuses says why, and so does a proxy’s size refusal', async ({ page, backend }) => {
  let reply: Reply = { status: 422, json: { statusCode: 422, message: 'The announcement must be at most 30 seconds; this one is 41 seconds' } };
  backend.route(on('POST', '/profiles/p-1/calls-announcement', () => reply));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const file = s.locator('input[type="file"]');
  await file.setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: sineWav(1) });
  await expect(s.getByRole('alert')).toContainText('The announcement must be at most 30 seconds; this one is 41 seconds');
  // A proxy in front of the API refused a file within the API's own 2 MB: its limit is the one to raise.
  reply = { status: 413, body: '<html><body>413 Request Entity Too Large</body></html>', headers: { 'content-type': 'text/html' } };
  await file.setInputFiles({ name: 'big.wav', mimeType: 'audio/wav', buffer: sineWav(1) });
  await expect(s.getByRole('alert')).toContainText('ask your administrator to allow uploads of at least 3 MB');
});

test('the announcement can be heard, and stays while recording is on', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ answerInDashboard: true, recording: true, announcement: { mimeType: 'audio/wav', durationSec: 2 } })));
  backend.route(on('GET', '/profiles/p-1/calls-announcement', { body: sineWav(2), headers: { 'content-type': 'audio/wav' } }));
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', { status: 409, json: { message: 'Turn recording off before removing the announcement', reasons: ['recording_on'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('button', { name: 'Listen' }).click();
  await expect(s.getByLabel('The announcement')).toHaveAttribute('src', /^blob:/);
  expect(backend.requests.find((r) => r.method === 'GET' && r.path === '/profiles/p-1/calls-announcement')?.headers.authorization).toBe('Bearer test-token');
  await s.getByRole('button', { name: 'Remove' }).click();
  await expect(s.getByRole('alert')).toContainText('Turn recording off first');
  await expect(s).toContainText('wav · 2.0 s');
});

test('recordings are kept for 1 to 3650 days', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  await expect(days).toHaveValue('90');
  const save = s.getByRole('button', { name: 'Save' });
  await days.fill('0');
  await expect(save).toBeDisabled();
  await days.fill('30');
  await save.click();
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 30 }]);
  await expect(save).toBeDisabled(); // saved: nothing left to save
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('does not see the calls settings', async ({ page }) => {
    await page.goto('/dashboard/profiles/p-1');
    await expect(page.getByRole('button', { name: 'Save guardrails' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });
});

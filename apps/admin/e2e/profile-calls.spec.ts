import { test, expect, gate, get, on, requestEnded, ME, PROFILE, STATUS, type FakeBackend, type Reply } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { sineWav } from './support/audio';
import type { Page } from '@playwright/test';

const section = (page: Page) => page.getByRole('region', { name: 'Calls', exact: true });
const status = (profile: Partial<(typeof STATUS)['profiles'][number]>) => ({ ...STATUS, profiles: [{ ...STATUS.profiles[0], ...profile }] });
const puts = (backend: FakeBackend) =>
  backend.requests.filter((r) => r.method === 'PUT' && r.path === '/profiles/p-1/calls-settings').map((r) => JSON.parse(r.body!.toString()));
const settings = (over: Record<string, unknown> = {}) => ({ profileId: 'p-1', answerInDashboard: false, recording: false, retentionDays: 90, announcement: null, ...over });
const ANNOUNCEMENT = { mimeType: 'audio/wav', durationSec: 2 };
/** Auto-reject is on for the profile until the guardrails turn it off (PUT /profiles/p-1), and the checklist says so. */
function autoRejectOn(backend: FakeBackend) {
  const state = { on: true };
  backend.route((r) => (r.method === 'GET' && r.path === '/calls/media/status' ? { json: state.on ? status({ ready: false, reasons: ['auto_reject_on'] }) : STATUS } : undefined));
  backend.route((r) => (r.method === 'GET' && r.path === '/accounts/acc-1/profiles/p-1' ? { json: { ...PROFILE, settings: { ...PROFILE.settings, autoRejectCalls: state.on } } } : undefined));
  backend.route(on('PUT', '/profiles/p-1', (r) => {
    state.on = JSON.parse(r.body!.toString()).autoRejectCalls;
    return { json: {} };
  }));
  return state;
}
async function turnAutoRejectOff(page: Page) {
  await page.getByRole('switch', { name: 'Auto-reject incoming calls' }).click();
  await page.getByRole('button', { name: 'Save guardrails' }).click();
}

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
  autoRejectOn(backend);
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Auto-reject is on for this profile: turn it off');
  await turnAutoRejectOff(page);
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s).not.toContainText('Auto-reject is on');
});

test('a refusal goes once its cause is fixed and the checklist is read again', async ({ page, backend }) => {
  autoRejectOn(backend);
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { status: 409, json: { message: 'Answering calls in the dashboard is not available for this profile', reasons: ['auto_reject_on'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('switch', { name: 'Answer calls in the dashboard' }).click();
  await expect(s.getByRole('alert')).toContainText('Answering calls in the dashboard is not available for this profile');
  await turnAutoRejectOff(page);
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s.getByRole('alert')).toHaveCount(0);
});

test('a read of the checklist that answers after a newer one leaves the newer one shown', async ({ page, backend }) => {
  const state = autoRejectOn(backend);
  // The reads made while auto-reject is on answer when the test says so, as on a slow link.
  const slow = gate();
  let held = 0;
  backend.route(on('GET', '/calls/media/status', async () => {
    if (!state.on) return { json: STATUS };
    held++;
    await slow.passed;
    return { json: status({ ready: false, reasons: ['auto_reject_on'] }) };
  }));
  let answered = 0;
  page.on('requestfinished', (r) => void (r.url().endsWith('/calls/media/status') && answered++));
  await page.goto('/dashboard/profiles/p-1');
  await expect.poll(() => held).toBeGreaterThan(0);
  await turnAutoRejectOff(page);
  const s = section(page);
  await expect(s).toContainText('This profile can take calls in the dashboard');
  const done = answered + held;
  slow.open();
  await expect.poll(() => answered).toBe(done);
  await page.waitForTimeout(300); // the page reads the late answers
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s).not.toContainText('Auto-reject is on');
});

test('the checklist says it is being read, and when the calls status does not list this profile', async ({ page, backend }) => {
  const slow = gate();
  backend.route(on('GET', '/calls/media/status', async () => {
    await slow.passed;
    return { json: { ...STATUS, profiles: [] } };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Reading the calls status…');
  slow.open();
  await expect(s).toContainText('The calls status does not list this profile');
  await expect(s).not.toContainText('Reading the calls status…');
});

test('Check again reads the checklist again', async ({ page, backend }) => {
  let reasons = ['not_ready'];
  backend.route((r) => (r.method === 'GET' && r.path === '/calls/media/status' ? { json: reasons.length ? status({ ready: false, reasons }) : STATUS } : undefined));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('WhatsApp Web is still loading');
  reasons = []; // loaded since
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s).not.toContainText('WhatsApp Web is still loading');
});

test('answering in the dashboard turns on for a profile that is ready, and the header’s call controls show at once', async ({ page, backend }) => {
  backend.route(get('/profiles', [{ ...PROFILE, settings: {} }])); // no profile answers in the dashboard yet
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { json: settings({ answerInDashboard: true }) }));
  await page.goto('/dashboard/profiles/p-1');
  const available = page.getByRole('switch', { name: 'Available for calls' });
  await expect(available).toHaveCount(0);
  const answer = section(page).getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.click();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  await expect(available).toBeVisible();
});

test('one change at a time: while a switch is saved, the other controls wait', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ announcement: ANNOUNCEMENT })));
  const slow = gate();
  backend.route(on('PUT', '/profiles/p-1/calls-settings', async () => {
    await slow.passed;
    return { json: settings({ answerInDashboard: true, announcement: ANNOUNCEMENT }) };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const record = s.getByRole('switch', { name: 'Record calls' });
  await expect(record).toBeEnabled();
  await s.getByRole('switch', { name: 'Answer calls in the dashboard' }).click();
  await expect.poll(() => puts(backend)).toEqual([{ answerInDashboard: true }]);
  await expect(record).toBeDisabled();
  await expect(s.getByRole('button', { name: 'Replace' })).toBeDisabled();
  await expect(s.getByRole('button', { name: 'Remove' })).toBeDisabled();
  slow.open();
  await expect(s.getByRole('switch', { name: 'Answer calls in the dashboard' })).toHaveAttribute('aria-checked', 'true');
  await expect(record).toBeEnabled();
});

test('a retention typed but not saved stays through a saved switch and a new read of the checklist', async ({ page, backend }) => {
  let stored = settings();
  backend.route((r) => (r.method === 'GET' && r.path === '/calls/media/status' ? { json: status(stored) } : undefined));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => {
    stored = { ...stored, ...JSON.parse(r.body!.toString()) };
    return { json: stored };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  await expect(days).toHaveValue('90');
  await days.fill('30');
  const answer = s.getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.click();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  await expect(days).toHaveValue('30');
  const reads = backend.requests.filter((r) => r.path === '/calls/media/status').length;
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => backend.requests.filter((r) => r.path === '/calls/media/status').length).toBe(reads + 1);
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible(); // read
  await expect(days).toHaveValue('30');
  await s.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => puts(backend)).toEqual([{ answerInDashboard: true }, { retentionDays: 30 }]);
  await expect(days).toHaveValue('30');
  await expect(s.getByRole('button', { name: 'Save' })).toBeDisabled();
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

test('an announcement larger than 2 MB, or not an audio file, is refused here without being sent', async ({ page, backend }) => {
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const file = s.locator('input[type="file"]');
  await file.setInputFiles({ name: 'long.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(s.getByRole('alert')).toHaveText('The file must be at most 2 MB');
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(s.getByRole('alert')).toHaveText('The announcement must be an mp3, wav, ogg, webm or m4a file');
  expect(backend.requests.filter((r) => r.path === '/profiles/p-1/calls-announcement')).toEqual([]);
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
  await page.getByRole('alertdialog', { name: 'Remove the announcement?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(s.getByRole('alert')).toContainText('Turn recording off first');
  await expect(s).toContainText('wav · 2.0 s');
});

test('leaving the page while the announcement loads gives the load up: no file is kept for nothing', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ announcement: ANNOUNCEMENT })));
  const slow = gate();
  backend.route(on('GET', '/profiles/p-1/calls-announcement', async () => {
    await slow.passed;
    return { body: sineWav(2), headers: { 'content-type': 'audio/wav' } };
  }));
  const ended = requestEnded(page, '/calls-announcement');
  await page.goto('/dashboard/profiles/p-1');
  await section(page).getByRole('button', { name: 'Listen' }).click();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Calls', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/calls$/);
  slow.open();
  await ended;
  await page.waitForTimeout(300); // what the page does with an answer
  expect(await page.evaluate(() => (window as any).__liveBlobs())).toEqual([]);
});

test('removing the announcement asks first', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ announcement: ANNOUNCEMENT })));
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', { json: { profileId: 'p-1', announcement: null } }));
  const deletes = () => backend.requests.filter((r) => r.method === 'DELETE').length;
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove the announcement?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(deletes()).toBe(0);
  await s.getByRole('button', { name: 'Remove' }).click();
  await expect(confirm.getByRole('button', { name: 'Remove' })).toHaveClass(/bg-red-600/);
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(s).toContainText('Upload an announcement first');
  await expect(confirm).toHaveCount(0);
  expect(deletes()).toBe(1);
  await expect(s.getByRole('button', { name: 'Upload announcement' })).toBeFocused(); // not the page: Remove went
});

test('closed without a removal, the dialog gives the focus back to Remove: Cancel, Escape, and a removal the server refused', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ answerInDashboard: true, recording: true, announcement: ANNOUNCEMENT })));
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', { status: 409, json: { message: 'Turn recording off before removing the announcement', reasons: ['recording_on'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const remove = s.getByRole('button', { name: 'Remove' });
  const confirm = page.getByRole('alertdialog', { name: 'Remove the announcement?' });
  await remove.click();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(s.getByRole('alert')).toContainText('Turn recording off first');
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
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

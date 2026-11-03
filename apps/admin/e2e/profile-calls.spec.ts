import { test, expect, gate, get, on, rendered, requestEnded, ME, PROFILE, STATUS, type FakeBackend, type Reply } from './support/fixtures';
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
  await expect(s.getByRole('list', { name: 'What answering in the dashboard needs' }).getByRole('listitem').first()).toHaveText('Ready: The server has calls in the dashboard turned on');
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
  await rendered(page); // the page has read the late answers
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s).not.toContainText('Auto-reject is on');
});

test('a read of the checklist that left before a save and answers after it leaves the save shown', async ({ page, backend }) => {
  let stored = settings();
  let hold = false;
  const slow = gate();
  backend.route(on('GET', '/calls/media/status', async () => {
    const then = status(stored); // what the server had when the read came
    if (hold) await slow.passed;
    return { json: then };
  }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => {
    stored = { ...stored, ...JSON.parse(r.body!.toString()) };
    return { json: stored };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const answer = s.getByRole('switch', { name: 'Answer calls in the dashboard' });
  await expect(answer).toHaveAttribute('aria-checked', 'false');
  hold = true;
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect(s.getByRole('button', { name: 'Checking…' })).toBeVisible();
  hold = false;
  await answer.click();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  const late = requestEnded(page, '/calls/media/status');
  slow.open();
  await late;
  await rendered(page); // the page has read the late answer
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible();
});

/** The calls status as the server has it when a read comes; `hold()` holds the next read's answer until `open()`. */
function heldStatus(backend: FakeBackend, now: () => Partial<(typeof STATUS)['profiles'][number]>) {
  const slow = gate();
  let next = false;
  backend.route(on('GET', '/calls/media/status', async () => {
    const then = status(now());
    if (next) {
      next = false;
      await slow.passed;
    }
    return { json: then };
  }));
  return { hold: () => (next = true), open: slow.open };
}

test('a read still out when a change answers is read again: the new read shows, and the old one is dropped', async ({ page, backend }) => {
  let stored = settings();
  let ready = false;
  const read = heldStatus(backend, () => ({ ...stored, ...(ready ? {} : { ready: false, reasons: ['auto_reject_on'] }) }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => {
    stored = { ...stored, ...JSON.parse(r.body!.toString()) };
    return { json: stored };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Auto-reject is on for this profile: turn it off');
  ready = true; // turned off since, elsewhere
  read.hold();
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect(s.getByRole('button', { name: 'Checking…' })).toBeVisible();
  const days = s.getByLabel('Keep recordings for (days)');
  await days.fill('120');
  await s.getByRole('button', { name: 'Save retention' }).click();
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 120 }]);
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible();
  const late = requestEnded(page, '/calls/media/status');
  read.open(); // the read that left before the save answers, with the retention as it was then
  await late;
  await rendered(page); // the page has read the late answer
  await expect(days).toHaveValue('120');
});

test('a change refused while a read is out leaves the read to answer, and its refusal stays', async ({ page, backend }) => {
  let ready = false;
  const read = heldStatus(backend, () => (ready ? {} : { ready: false, reasons: ['auto_reject_on'] }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { status: 409, json: { message: 'Answering calls in the dashboard is not available for this profile', reasons: ['auto_reject_on'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await expect(s).toContainText('Auto-reject is on for this profile: turn it off');
  ready = true;
  read.hold();
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect(s.getByRole('button', { name: 'Checking…' })).toBeVisible();
  await s.getByRole('switch', { name: 'Answer calls in the dashboard' }).click();
  const refusal = s.getByRole('alert');
  await expect(refusal).toContainText('Answering calls in the dashboard is not available for this profile');
  await expect(s.getByRole('button', { name: 'Checking…' })).toBeVisible(); // a refusal changed nothing: the read goes on
  read.open();
  await expect(s).toContainText('This profile can take calls in the dashboard');
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(refusal).toContainText('Answering calls in the dashboard is not available for this profile'); // the read left before it
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
  // A file picked meanwhile (its chooser opened before) waits too: it is not sent.
  await s.locator('input[type="file"]').setInputFiles({ name: 'notice.wav', mimeType: 'audio/wav', buffer: sineWav(2) });
  slow.open();
  await expect(s.getByRole('switch', { name: 'Answer calls in the dashboard' })).toHaveAttribute('aria-checked', 'true');
  await expect(record).toBeEnabled();
  expect(backend.requests.filter((r) => r.path === '/profiles/p-1/calls-announcement').map((r) => r.method)).toEqual([]);
});

test('a switch pressed with Space keeps the focus while it is saved and after; Space again meanwhile changes nothing', async ({ page, backend }) => {
  const slow = gate();
  backend.route(on('PUT', '/profiles/p-1/calls-settings', async () => {
    await slow.passed;
    return { json: settings({ answerInDashboard: true }) };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const answer = section(page).getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => puts(backend)).toEqual([{ answerInDashboard: true }]);
  await expect(answer).toBeDisabled();
  await rendered(page);
  await expect(answer).toBeFocused();
  await page.keyboard.press('Space'); // while it is saved
  await rendered(page);
  await expect(answer).toHaveAttribute('aria-checked', 'false');
  slow.open();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  await expect(answer).toBeEnabled();
  await expect(answer).toBeFocused();
  expect(puts(backend)).toEqual([{ answerInDashboard: true }]); // answered: a save sent before would have reached the server
});

test('the retention’s Save keeps the focus while it saves and once saved, pressed with Enter or clicked', async ({ page, backend }) => {
  let slow = gate();
  backend.route(on('PUT', '/profiles/p-1/calls-settings', async (r) => {
    await slow.passed;
    return { json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  const save = s.getByRole('button', { name: 'Save retention' });
  const pressEnter = async () => {
    await save.focus();
    await page.keyboard.press('Enter');
  };
  for (const [value, press] of [['120', pressEnter], ['150', () => save.click()]] as const) {
    slow = gate();
    await days.fill(value);
    const answered = requestEnded(page, '/calls-settings');
    await press();
    await expect.poll(() => puts(backend).at(-1)).toEqual({ retentionDays: Number(value) });
    await rendered(page);
    await expect(save).toBeFocused(); // while it saves
    slow.open();
    await answered;
    await expect(page.getByRole('status').filter({ hasText: `Recordings are kept for ${value} days` }).first()).toBeVisible(); // read
    await expect(save).toBeDisabled(); // saved: nothing left to save
    await expect(save).toBeFocused();
  }
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
  await days.fill('120');
  const answer = s.getByRole('switch', { name: 'Answer calls in the dashboard' });
  await answer.click();
  await expect(answer).toHaveAttribute('aria-checked', 'true');
  await expect(days).toHaveValue('120');
  const reads = backend.requests.filter((r) => r.path === '/calls/media/status').length;
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => backend.requests.filter((r) => r.path === '/calls/media/status').length).toBe(reads + 1);
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible(); // read
  await expect(days).toHaveValue('120');
  await s.getByRole('button', { name: 'Save retention' }).click();
  await expect.poll(() => puts(backend)).toEqual([{ answerInDashboard: true }, { retentionDays: 120 }]);
  await expect(days).toHaveValue('120');
  await expect(s.getByRole('button', { name: 'Save retention' })).toBeDisabled();
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

test('recording refused for a public storage still says why once the checklist is read again: its last check failed', async ({ page, backend }) => {
  let lastCheck: { at: string; ok: boolean; reason?: string } = STATUS.server.recordings.lastCheck;
  backend.route(on('GET', '/calls/media/status', () => ({
    json: { ...status({ announcement: ANNOUNCEMENT }), server: { ...STATUS.server, recordings: { ...STATUS.server.recordings, lastCheck } } },
  })));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', () => {
    lastCheck = { at: '2026-11-01T03:00:00.000Z', ok: false, reason: 'storage_not_private' }; // the check the switch made
    return { status: 409, json: { message: 'Recording calls is not available for this profile', reasons: ['storage_not_private'] } };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const record = s.getByRole('switch', { name: 'Record calls' });
  const why = 'The recording storage can be read without a login: ask your administrator to make it private';
  await expect(s.getByRole('button', { name: 'Check again' })).toBeVisible(); // read
  await expect(s).not.toContainText(why);
  await record.click();
  await expect(s.getByRole('alert')).toContainText(why);
  await s.getByRole('button', { name: 'Check again' }).click();
  await expect(s.getByRole('alert')).toHaveCount(0); // read after the refusal: the section says what is missing now
  await expect(s).toContainText(why);
  await expect(record).toHaveAttribute('aria-checked', 'false');
});

test('a failed check of the storage says why only while recording is off: once recording is turned on (its check passed), the line goes', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', {
    ...status({ announcement: ANNOUNCEMENT }),
    server: { ...STATUS.server, recordings: { ...STATUS.server.recordings, lastCheck: { at: '2026-11-01T02:30:00.000Z', ok: false, reason: 'storage_not_private' } } },
  }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', { json: settings({ recording: true, announcement: ANNOUNCEMENT }) }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const why = 'The recording storage can be read without a login: ask your administrator to make it private';
  await expect(s).toContainText(why);
  const record = s.getByRole('switch', { name: 'Record calls' });
  await record.click();
  await expect(record).toHaveAttribute('aria-checked', 'true');
  await expect(s).not.toContainText(why);
});

test('a screen reader hears what went through: an upload and a saved retention are said, and the announcement’s player takes the focus from Listen', async ({ page, backend }) => {
  backend.route(on('POST', '/profiles/p-1/calls-announcement', { json: { profileId: 'p-1', announcement: ANNOUNCEMENT } }));
  backend.route(on('GET', '/profiles/p-1/calls-announcement', { body: sineWav(2), headers: { 'content-type': 'audio/wav' } }));
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ announcement: ANNOUNCEMENT, retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const said = (text: string) => page.getByRole('status').filter({ hasText: text }).first();
  await s.locator('input[type="file"]').setInputFiles({ name: 'notice.wav', mimeType: 'audio/wav', buffer: sineWav(2) });
  await expect(said('Announcement uploaded')).toBeVisible();
  await s.getByLabel('Keep recordings for (days)').fill('120');
  await s.getByRole('button', { name: 'Save retention' }).click();
  await expect(said('Recordings are kept for 120 days')).toBeVisible();
  await s.getByRole('button', { name: 'Listen' }).click();
  await expect(s.getByLabel('The announcement')).toBeFocused();
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
  reply = { status: 409, json: { message: 'The call recordings storage is not configured on this server', reasons: ['recordings_storage_unset'] } };
  await file.setInputFiles({ name: 'notice.wav', mimeType: 'audio/wav', buffer: sineWav(1) });
  await expect(s.getByRole('alert')).toContainText('The call recordings storage is not configured on this server');
  await expect(s.getByRole('alert').getByRole('listitem')).toHaveText(['Recording storage is not set up on the server: ask your administrator']);
});

test('an announcement of a type the browser names its own way (audio/x-m4a) goes by its name: an .m4a is sent', async ({ page, backend }) => {
  backend.route(on('POST', '/profiles/p-1/calls-announcement', { json: { profileId: 'p-1', announcement: { mimeType: 'audio/mp4', durationSec: 2 } } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.locator('input[type="file"]').setInputFiles({ name: 'notice.m4a', mimeType: 'audio/x-m4a', buffer: sineWav(2) });
  await expect(s).toContainText('m4a · 2.0 s');
  await expect(s.getByRole('alert')).toHaveCount(0);
  expect(backend.requests.filter((r) => r.path === '/profiles/p-1/calls-announcement').map((r) => r.method)).toEqual(['POST']);
});

test('an announcement that cannot be loaded now (a 503) says why, and nothing plays', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ announcement: ANNOUNCEMENT })));
  backend.route(on('GET', '/profiles/p-1/calls-announcement', { status: 503, json: { message: 'Another announcement is being read; try again in a moment' } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('button', { name: 'Listen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Could not load the announcement' }).first()).toContainText('Another announcement is being read; try again in a moment');
  await expect(s.getByLabel('The announcement')).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Listen' })).toBeEnabled();
});

test('the announcement can be heard, and stays while recording is on: Remove is not offered, and the section says why', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ answerInDashboard: true, recording: true, announcement: { mimeType: 'audio/wav', durationSec: 2 } })));
  backend.route(on('GET', '/profiles/p-1/calls-announcement', { body: sineWav(2), headers: { 'content-type': 'audio/wav' } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('button', { name: 'Listen' }).click();
  await expect(s.getByLabel('The announcement')).toHaveAttribute('src', /^blob:/);
  expect(backend.requests.find((r) => r.method === 'GET' && r.path === '/profiles/p-1/calls-announcement')?.headers.authorization).toBe('Bearer test-token');
  await expect(s).toContainText('Turn recording off to remove the announcement');
  await expect(s.getByRole('button', { name: 'Remove' })).toHaveCount(0);
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
  await rendered(page); // what the page does with an answer is done by now
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
  await expect(confirm).toContainText('Recording calls needs an announcement: it can’t be turned on until another one is uploaded');
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

test('closed without a removal, the dialog gives the focus back to Remove: Cancel, Escape, and a removal that failed', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ answerInDashboard: true, announcement: ANNOUNCEMENT })));
  const slow = gate();
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', async () => {
    await slow.passed;
    return { status: 500, json: { message: 'Internal server error' } };
  }));
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
  const removing = confirm.getByRole('button', { name: 'Removing…' });
  await expect(removing).toBeDisabled();
  await rendered(page);
  await expect(removing).toBeFocused(); // while the removal runs
  slow.open();
  await expect(s.getByRole('alert')).toContainText('Internal server error');
  await expect(confirm).toHaveCount(0);
  await expect(remove).toBeFocused();
});

test('a removal refused because recording was turned on elsewhere shows recording on and says why; Remove goes, and the focus goes to the upload', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ answerInDashboard: true, announcement: ANNOUNCEMENT })));
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', { status: 409, json: { message: 'Turn recording off before removing the announcement', reasons: ['recording_on'] } }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const record = s.getByRole('switch', { name: 'Record calls' });
  await expect(record).toHaveAttribute('aria-checked', 'false');
  await s.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove the announcement?' });
  await confirm.getByRole('button', { name: 'Remove' }).click();
  // The refusal says what to do, then why, each once; the section shows it too.
  await expect(s.getByRole('alert')).toContainText('Turn recording off before removing the announcement');
  await expect(s.getByRole('alert').getByRole('listitem')).toHaveText(['Recording is on for this profile']);
  await expect(confirm).toHaveCount(0);
  await expect(record).toHaveAttribute('aria-checked', 'true');
  await expect(s).toContainText('Turn recording off to remove the announcement');
  await expect(s.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Replace' })).toBeFocused(); // not the page: Remove went
});

test('Escape while the removal runs leaves the dialog open: once removed, the focus goes to the upload, not to the page', async ({ page, backend }) => {
  backend.route(get('/calls/media/status', status({ announcement: ANNOUNCEMENT })));
  const slow = gate();
  backend.route(on('DELETE', '/profiles/p-1/calls-announcement', async () => {
    await slow.passed;
    return { json: { profileId: 'p-1', announcement: null } };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Remove the announcement?' });
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(confirm.getByRole('button', { name: 'Removing…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await rendered(page); // the key was handled: a dialog it closed says so by now
  await expect(confirm).toHaveAttribute('data-state', 'open');
  slow.open();
  await expect(s).toContainText('Upload an announcement first');
  await expect(confirm).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Upload announcement' })).toBeFocused();
});

test('recordings are kept for 1 to 3650 days', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  await expect(days).toHaveValue('90');
  const save = s.getByRole('button', { name: 'Save retention' });
  await days.fill('0');
  await expect(save).toBeDisabled();
  await days.fill('365');
  await save.click();
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 365 }]);
  await expect(save).toBeDisabled(); // saved: nothing left to save
});

test('a shorter retention asks first, as the next nightly cleanup deletes the older recordings; a longer one does not', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  const save = s.getByRole('button', { name: 'Save retention' });
  const confirm = page.getByRole('alertdialog', { name: 'Keep recordings for 30 days?' });
  await days.fill('30');
  await save.click();
  await expect(confirm).toContainText('This profile’s recordings older than 30 days are deleted for good at the next nightly cleanup, at 02:30 server time');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(save).toBeFocused();
  expect(puts(backend)).toEqual([]);
  await days.press('Enter'); // from the field: the focus comes back to it
  await expect(confirm.getByRole('button', { name: 'Keep for 30 days' })).toHaveClass(/bg-red-600/);
  await confirm.getByRole('button', { name: 'Keep for 30 days' }).click();
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 30 }]);
  await expect(confirm).toHaveCount(0);
  await expect(days).toBeFocused();
  await days.fill('60');
  await save.click();
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 30 }, { retentionDays: 60 }]);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('the shorter retention’s dialog stays open while it saves: Escape leaves it, it says Saving…, and Cancel waits; once saved, the focus goes back to Save', async ({ page, backend }) => {
  const slow = gate();
  backend.route(on('PUT', '/profiles/p-1/calls-settings', async (r) => {
    await slow.passed;
    return { json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) };
  }));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByLabel('Keep recordings for (days)').fill('30');
  const save = s.getByRole('button', { name: 'Save retention' });
  await save.click();
  const confirm = page.getByRole('alertdialog', { name: 'Keep recordings for 30 days?' });
  await confirm.getByRole('button', { name: 'Keep for 30 days' }).click();
  const saving = confirm.getByRole('button', { name: 'Saving…' });
  await expect(saving).toBeDisabled();
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await rendered(page);
  await expect(saving).toBeFocused(); // while the save runs
  await page.keyboard.press('Escape');
  await rendered(page); // the key was handled: a dialog it closed says so by now
  await expect(confirm).toHaveAttribute('data-state', 'open');
  slow.open();
  await expect(page.getByText('Recordings are kept for 30 days', { exact: true })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(save).toBeFocused();
  expect(puts(backend)).toEqual([{ retentionDays: 30 }]);
});

test('closed by a save that failed or was refused, the shorter retention’s dialog gives the focus back to where it was asked from, and the days stay to save', async ({ page, backend }) => {
  let reply: Reply = { status: 500, json: { message: 'Internal server error' } };
  backend.route(on('PUT', '/profiles/p-1/calls-settings', () => reply));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  const save = s.getByRole('button', { name: 'Save retention' });
  const confirm = page.getByRole('alertdialog', { name: 'Keep recordings for 30 days?' });
  const failed = (description: string) => page.getByRole('status').filter({ hasText: 'Could not save' }).filter({ hasText: description }).first();
  await days.fill('30');
  await save.click(); // asked from Save
  await confirm.getByRole('button', { name: 'Keep for 30 days' }).click();
  await expect(failed('Internal server error')).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(save).toBeFocused();
  await expect(days).toHaveValue('30');
  reply = { status: 403, json: { message: 'Forbidden resource' } }; // the login was made a member meanwhile
  await days.press('Enter'); // asked from the field
  await confirm.getByRole('button', { name: 'Keep for 30 days' }).click();
  await expect(failed('Forbidden resource')).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(days).toBeFocused();
  await expect(days).toHaveValue('30');
  expect(puts(backend)).toEqual([{ retentionDays: 30 }, { retentionDays: 30 }]);
});

test('the shortest retention, 1 day, is said as one day: the dialog, its button and the toast', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  await s.getByLabel('Keep recordings for (days)').fill('1');
  await s.getByRole('button', { name: 'Save retention' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Keep recordings for 1 day?' });
  await expect(confirm).toContainText('This profile’s recordings older than 1 day are deleted for good');
  await confirm.getByRole('button', { name: 'Keep for 1 day', exact: true }).click();
  await expect(page.getByText('Recordings are kept for 1 day', { exact: true })).toBeVisible();
  expect(puts(backend)).toEqual([{ retentionDays: 1 }]);
});

test('a retention out of the server’s range says why, and Enter in the field saves it', async ({ page, backend }) => {
  backend.route(on('PUT', '/profiles/p-1/calls-settings', (r) => ({ json: settings({ retentionDays: JSON.parse(r.body!.toString()).retentionDays }) })));
  await page.goto('/dashboard/profiles/p-1');
  const s = section(page);
  const days = s.getByLabel('Keep recordings for (days)');
  const save = s.getByRole('button', { name: 'Save retention' });
  const border = () => days.evaluate((el) => getComputedStyle(el).borderTopColor);
  await expect(days).toHaveAttribute('aria-invalid', 'false');
  const valid = await border();
  for (const value of ['0', '3651', '1.5']) {
    await days.fill(value);
    await expect(days).toHaveAttribute('aria-invalid', 'true');
    await expect(days).toHaveAccessibleDescription('A whole number of days from 1 to 3650');
    await expect(save).toBeDisabled();
    await expect.poll(border).toBe('rgb(251, 191, 36)'); // the field itself says so too: amber, as its help
  }
  await days.fill('3650');
  await expect(days).toHaveAttribute('aria-invalid', 'false');
  await expect.poll(border).toBe(valid);
  await days.press('Enter');
  await expect.poll(() => puts(backend)).toEqual([{ retentionDays: 3650 }]);
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('does not see the calls settings', async ({ page }) => {
    await page.goto('/dashboard/profiles/p-1');
    await expect(page.getByRole('button', { name: 'Save guardrails' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });
});

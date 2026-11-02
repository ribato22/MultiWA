import { test, expect, gate, on, rendered, requestEnded, ME, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { sineWav } from './support/audio';
import type { Locator, Page } from '@playwright/test';

const NOW = '2026-11-01T03:10:00.000Z';
const REC = { id: 'rec-9', durationSec: 190, bytes: 95_000, partial: true, announcementPlayed: true, createdAt: NOW, deletedAt: null, deleteReason: null };
const ANSWERED = {
  id: 'call-9', profileId: PROFILE.id, waCallId: 'W9', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:03:18.000Z',
  followUp: 'open', assignedUserId: null, conversationId: 'conv-1', answeredByUserId: 'u-jane', answeredAt: '2026-11-01T03:00:06.000Z',
  endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 192, assignedUser: null, answeredBy: { id: 'u-jane', name: 'Jane' },
  conversation: { id: 'conv-1', name: 'Pak Joko' }, recording: REC as Record<string, unknown> | null,
};
/** The calls list (the ringing strip asks for `outcome=ringing`: none), and the row that `GET /calls/:id` reads. */
function listing(backend: FakeBackend, row: () => typeof ANSWERED) {
  backend.route((r) => (r.method === 'GET' && r.path === '/calls' ? { json: { calls: r.query.get('outcome') === 'ringing' ? [] : [row()], nextCursor: null } } : undefined));
  backend.route(on('GET', '/calls/call-9', () => ({ json: row() })));
}
const rowOf = (page: Page, caller = 'Pak Joko') => page.getByRole('list', { name: 'Calls', exact: true }).getByRole('listitem').filter({ hasText: caller });
const WAV = { body: sineWav(2), headers: { 'content-type': 'audio/wav' } };
const deleteRecording = async (page: Page) => {
  await rowOf(page).getByRole('button', { name: 'Delete the recording' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this recording?' }).getByRole('button', { name: 'Delete' }).click();
};
/** What has the focus: `<body>` when nothing does. */
const focused = (page: Page) => page.evaluate(() => (document.activeElement === document.body ? '<body>' : document.activeElement?.textContent));
/** Whether the recording `player` plays. */
const playing = (player: Locator) => player.evaluate((a: HTMLAudioElement) => !a.paused);

test('an answered call shows who answered, how fast, the talk time and its recording, with a player for an admin', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('GET', '/calls/call-9/recording', { body: sineWav(2), headers: { 'content-type': 'audio/wav' } }));
  await page.goto('/dashboard/calls');
  const row = rowOf(page);
  await expect(row.getByText('Answered', { exact: true })).toBeVisible();
  await expect(row).toContainText('Answered by Jane · 6 s to answer · Talk 3:12');
  await expect(row).toContainText('Recording 3:10');
  await expect(row.getByText('Partial: the server stopped before the call ended')).toBeVisible(); // not only on hover
  await row.getByRole('button', { name: 'Play the recording of the call from Pak Joko' }).click();
  const audio = row.getByLabel('Recording of the call from Pak Joko', { exact: true });
  await expect(audio).toHaveAttribute('src', /^blob:/);
  expect(backend.requests.find((r) => r.path === '/calls/call-9/recording')?.headers.authorization).toBe('Bearer test-token');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(2, 0);
  await audio.evaluate((a: HTMLAudioElement) => new Promise<void>((resolve) => {
    a.pause();
    a.onseeked = () => resolve();
    a.currentTime = 1.5;
  }));
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeCloseTo(1.5, 1);
  await expectAccessible(page, 'ul[aria-label="Calls"]');
});

test('an admin downloads a recording as a file', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('GET', '/calls/call-9/recording', { body: sineWav(1), headers: { 'content-type': 'audio/webm' } }));
  await page.goto('/dashboard/calls');
  const button = rowOf(page).getByRole('button', { name: 'Download the recording of the call from Pak Joko' });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('call-call-9.webm');
  const asked = backend.requests.find((r) => r.path === '/calls/call-9/recording' && r.query.get('download') === '1');
  expect(asked?.headers.authorization).toBe('Bearer test-token');
});

test('Download keeps the focus while its file comes, and after', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return { body: sineWav(1), headers: { 'content-type': 'audio/webm' } };
  }));
  await page.goto('/dashboard/calls');
  const download = rowOf(page).getByRole('button', { name: 'Download the recording of the call from Pak Joko' });
  await download.focus();
  await page.keyboard.press('Enter');
  await expect(download).toBeDisabled();
  await rendered(page);
  await expect(download).toBeFocused();
  const [file] = await Promise.all([page.waitForEvent('download'), slow.open()]);
  expect(file.suggestedFilename()).toBe('call-call-9.webm');
  await expect(download).toBeEnabled();
  await expect(download).toBeFocused();
});

test('one action at a time in a row: Play while its file downloads, or Download while it loads to play, asks for no second file', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  let slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return WAV;
  }));
  const asked = () => backend.requests.filter((r) => r.path === '/calls/call-9/recording').length;
  await page.goto('/dashboard/calls');
  const row = rowOf(page);
  const play = row.getByRole('button', { name: /^Play/ });
  const download = row.getByRole('button', { name: 'Download the recording of the call from Pak Joko' });
  // Keys reach a button that waits, as a press does: it must do nothing.
  const press = async (button: Locator) => {
    await button.focus();
    await page.keyboard.press('Enter');
  };
  await press(download);
  await expect.poll(asked).toBe(1);
  await press(play);
  await page.waitForTimeout(300); // a second request would be out by now
  expect(asked()).toBe(1);
  await expect(play).toBeDisabled();
  await Promise.all([page.waitForEvent('download'), slow.open()]);
  await expect(play).toBeEnabled();
  slow = gate();
  await press(play);
  await expect.poll(asked).toBe(2);
  const loading = row.getByRole('button', { name: /^Loading/ });
  await press(download);
  await page.waitForTimeout(300); // a second request would be out by now
  expect(asked()).toBe(2);
  await expect(loading).toBeDisabled(); // still loading, and says so
  slow.open();
  await expect(row.getByLabel(/^Recording of the call/)).toBeVisible();
  await expect(download).toBeFocused(); // the player takes the focus only from Play
});

test('an admin deletes a recording after confirming; the row then says it was deleted', async ({ page, backend }) => {
  let deleted = false;
  listing(backend, () => (deleted ? { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'admin' } } : ANSWERED));
  backend.route(on('DELETE', '/calls/call-9/recording', () => {
    deleted = true;
    return { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } };
  }));
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: 'Delete the recording of the call from Pak Joko' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this recording?' });
  await expect(confirm).toContainText('The recording of the call from Pak Joko is deleted for good');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(confirm).toHaveCount(0);
  await expect(rowOf(page).getByRole('button', { name: 'Play' })).toHaveCount(0);
});

test('after a delete the focus stays on the row, and a toast says the recording was deleted', async ({ page, backend }) => {
  let deleted = false;
  listing(backend, () => (deleted ? { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'admin' } } : ANSWERED));
  backend.route(on('DELETE', '/calls/call-9/recording', () => {
    deleted = true;
    return { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } };
  }));
  await page.goto('/dashboard/calls');
  await deleteRecording(page);
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect.poll(() => focused(page)).toBe('Recording deleted by an admin');
  await expect(page.getByRole('status').filter({ hasText: 'Recording deleted' }).first()).toBeVisible();
  await expectAccessible(page, 'ul[aria-label="Calls"]');
});

test('closed without a delete, the dialog gives the focus back to Delete: Cancel, Escape, and a delete that failed', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('DELETE', '/calls/call-9/recording', async () => {
    await slow.passed;
    return { status: 500, json: { message: 'Internal server error' } };
  }));
  await page.goto('/dashboard/calls');
  const del = rowOf(page).getByRole('button', { name: 'Delete the recording of the call from Pak Joko' });
  const confirm = page.getByRole('alertdialog', { name: 'Delete this recording?' });
  await del.click();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
  await del.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
  await del.click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  const deleting = confirm.getByRole('button', { name: 'Deleting…' });
  await expect(deleting).toBeDisabled();
  await rendered(page);
  await expect(deleting).toBeFocused(); // while the delete runs
  slow.open();
  await expect(page.getByText('Could not delete the recording')).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
});

test('Escape while the delete runs leaves the dialog open: once deleted, the focus goes to the row, not to the page', async ({ page, backend }) => {
  let deleted = false;
  listing(backend, () => (deleted ? { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'admin' } } : ANSWERED));
  const slow = gate();
  backend.route(on('DELETE', '/calls/call-9/recording', async () => {
    await slow.passed;
    deleted = true;
    return { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } };
  }));
  await page.goto('/dashboard/calls');
  await deleteRecording(page);
  const confirm = page.getByRole('alertdialog', { name: 'Delete this recording?' });
  await expect(confirm.getByRole('button', { name: 'Deleting…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300); // the dialog would be closed by now
  await expect(confirm).toBeVisible();
  slow.open();
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(confirm).toHaveCount(0);
  await expect.poll(() => focused(page)).toBe('Recording deleted by an admin');
});

test('a delete that went through says so, even when the row cannot be read again', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('DELETE', '/calls/call-9/recording', { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } }));
  await page.goto('/dashboard/calls');
  await expect(rowOf(page)).toContainText('Recording 3:10');
  backend.route(on('GET', '/calls/call-9', { status: 500, json: { message: 'Internal server error' } }));
  await deleteRecording(page);
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(rowOf(page).getByRole('button', { name: 'Play' })).toHaveCount(0);
  await expect(page.getByText('Could not delete the recording')).toHaveCount(0);
});

for (const [done, button] of [['played', 'Play'], ['downloaded', 'Download the recording']] as const) {
  test(`a recording its retention removed since the list was read says so once ${done}`, async ({ page, backend }) => {
    backend.route((r) => (r.method === 'GET' && r.path === '/calls' ? { json: { calls: r.query.get('outcome') === 'ringing' ? [] : [ANSWERED], nextCursor: null } } : undefined));
    backend.route(on('GET', '/calls/call-9', { json: { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'retention' } } }));
    backend.route(on('GET', '/calls/call-9/recording', { status: 404, json: { message: 'Recording not found' } }));
    await page.goto('/dashboard/calls');
    await rowOf(page).getByRole('button', { name: button }).click();
    await expect(rowOf(page)).toContainText('Recording deleted after its retention period');
    await expect(rowOf(page).getByRole('button', { name: button })).toHaveCount(0);
  });
}

test('Play keeps the focus while its file loads, then hands it to the player that takes its place', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return WAV;
  }));
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: /^Play/ }).click();
  await rendered(page);
  await expect(rowOf(page).getByRole('button', { name: /^Loading/ })).toBeFocused();
  slow.open();
  await expect(rowOf(page).getByLabel('Recording of the call from Pak Joko', { exact: true })).toBeFocused();
});

test('one recording plays at a time: playing another pauses the first', async ({ page, backend }) => {
  const SARI = {
    ...ANSWERED, id: 'call-8', waCallId: 'W8', fromJid: '628222000222@s.whatsapp.net', startedAt: '2026-11-01T02:00:00.000Z', endedAt: '2026-11-01T02:03:18.000Z',
    answeredAt: '2026-11-01T02:00:06.000Z', conversationId: 'conv-2', conversation: { id: 'conv-2', name: 'Bu Sari' }, recording: { ...REC, id: 'rec-8' },
  };
  backend.route((r) => (r.method === 'GET' && r.path === '/calls' ? { json: { calls: r.query.get('outcome') === 'ringing' ? [] : [ANSWERED, SARI], nextCursor: null } } : undefined));
  backend.route(on('GET', /^\/calls\/call-[89]\/recording$/, { body: sineWav(20), headers: { 'content-type': 'audio/wav' } }));
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: 'Play the recording of the call from Pak Joko' }).click();
  const first = rowOf(page).getByLabel('Recording of the call from Pak Joko', { exact: true });
  await expect.poll(() => playing(first)).toBe(true);
  await rowOf(page, 'Bu Sari').getByRole('button', { name: 'Play the recording of the call from Bu Sari' }).click();
  await expect.poll(() => playing(rowOf(page, 'Bu Sari').getByLabel('Recording of the call from Bu Sari', { exact: true }))).toBe(true);
  await expect.poll(() => playing(first)).toBe(false); // paused in the second one's play event, a moment later
});

test('a recording under 0.1 MB says so while it loads', async ({ page, backend }) => {
  listing(backend, () => ({ ...ANSWERED, recording: { ...REC, bytes: 40_000 } }));
  const slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return WAV;
  }));
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: 'Play' }).click();
  await expect(rowOf(page).getByRole('button', { name: 'Loading < 0.1 MB…' })).toBeDisabled();
  slow.open();
  await expect(rowOf(page).getByLabel('Recording of the call from Pak Joko', { exact: true })).toBeVisible();
});

test('leaving the page while a recording loads gives the load up: no file is kept for nothing', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return WAV;
  }));
  const ended = requestEnded(page, '/calls/call-9/recording');
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: 'Play' }).click();
  await expect(rowOf(page).getByRole('button', { name: /^Loading/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  slow.open();
  await ended;
  await page.waitForTimeout(300); // what the page does with an answer
  expect(await page.evaluate(() => (window as any).__liveBlobs())).toEqual([]);
});

test('a recording the retention removed says so', async ({ page, backend }) => {
  listing(backend, () => ({ ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'retention' } }));
  await page.goto('/dashboard/calls');
  await expect(rowOf(page)).toContainText('Recording deleted after its retention period');
});

test('a recording stored after the call shows up without a reload', async ({ page, backend }) => {
  let stored = false;
  listing(backend, () => (stored ? ANSWERED : { ...ANSWERED, recording: null }));
  await page.goto('/dashboard/calls');
  const row = rowOf(page);
  await expect(row).toContainText('Answered by Jane');
  await expect(row).not.toContainText('Recording');
  await expect.poll(() => backend.joined).toContain(PROFILE.id);
  stored = true;
  backend.emitToProfile(PROFILE.id, 'call:update', {
    profileId: PROFILE.id, callId: 'call-9', waCallId: 'W9', from: ANSWERED.fromJid, isVideo: false, isGroup: false, direction: 'incoming',
    outcome: 'answered', rejectedBy: null, startedAt: ANSWERED.startedAt, endedAt: ANSWERED.endedAt, followUp: 'open', assignedUserId: null,
    answeredByUserId: 'u-jane', answeredAt: ANSWERED.answeredAt, endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 192, hasRecording: true,
  });
  await expect(row).toContainText('Recording 3:10');
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('sees the recording facts, but no player, download or delete', async ({ page, backend }) => {
    listing(backend, () => ANSWERED);
    await page.goto('/dashboard/calls');
    const row = rowOf(page);
    await expect(row).toContainText('Recording 3:10');
    for (const name of ['Play', 'Download the recording', 'Delete the recording']) await expect(row.getByRole('button', { name })).toHaveCount(0);
  });
});

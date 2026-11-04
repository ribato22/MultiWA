import { test, expect, gate, on, rendered, requestEnded, toasts, ME, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { sineWav } from './support/audio';
import type { Locator, Page } from '@playwright/test';

const NOW = '2026-11-01T03:10:00.000Z';
const REC = { id: 'rec-9', durationSec: 190, bytes: 95_000, partial: true, announcementPlayed: true, createdAt: NOW, deletedAt: null, deleteReason: null };
const ANSWERED = {
  id: 'call-9', profileId: PROFILE.id, waCallId: 'W9', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
  direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:03:18.000Z',
  // A call answered needs no follow-up: the server marks it done.
  followUp: 'done', assignedUserId: null, conversationId: 'conv-1', answeredByUserId: 'u-jane', answeredAt: '2026-11-01T03:00:06.000Z',
  endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 192, assignedUser: null, answeredBy: { id: 'u-jane', name: 'Jane' },
  conversation: { id: 'conv-1', name: 'Pak Joko' }, recording: REC as Record<string, unknown> | null,
};
type Row = typeof ANSWERED;
/** The calls list, filtered as the server does (the ringing strip asks for `outcome=ringing`), and the rows `GET /calls/:id` reads. */
function listing(backend: FakeBackend, rows: () => Row | Row[]) {
  const all = () => [rows()].flat();
  backend.route((r) => {
    if (r.method !== 'GET' || r.path !== '/calls') return undefined;
    const [outcome, followUp] = [r.query.get('outcome'), r.query.get('followUp')];
    return { json: { calls: all().filter((c) => (!outcome || c.outcome === outcome) && (!followUp || c.followUp === followUp)), nextCursor: null } };
  });
  backend.route((r) => {
    const row = r.method === 'GET' ? all().find((c) => r.path === `/calls/${c.id}`) : undefined;
    return row && { json: row };
  });
}
/** The Calls page on its Answered tab: the Open tab leaves an answered call out, as it is done. */
async function openAnswered(page: Page) {
  await page.goto('/dashboard/calls');
  await page.getByRole('tab', { name: 'Answered' }).click();
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
  await openAnswered(page);
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

test('an answered call is done, so the Open tab leaves it out: the Answered tab lists it, as the server filters it', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  await page.goto('/dashboard/calls');
  await expect(page.getByText('No calls here')).toBeVisible();
  await page.getByRole('tab', { name: 'Answered' }).click();
  await expect(rowOf(page)).toContainText('Answered by Jane');
  expect(backend.requests.filter((r) => r.path === '/calls').map((r) => r.query.toString())).toContain('profileId=p-1&outcome=answered');
});

test('an admin downloads a recording as a file', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('GET', '/calls/call-9/recording', { body: sineWav(1), headers: { 'content-type': 'audio/webm' } }));
  await openAnswered(page);
  const button = rowOf(page).getByRole('button', { name: 'Download the recording of the call from Pak Joko' });
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toBe('call-call-9.webm');
  const asked = backend.requests.find((r) => r.path === '/calls/call-9/recording' && r.query.get('download') === '1');
  expect(asked?.headers.authorization).toBe('Bearer test-token');
});

test('Download keeps the focus while its file comes, and after; a screen reader hears it download, and that it did', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('GET', '/calls/call-9/recording', async () => {
    await slow.passed;
    return { body: sineWav(1), headers: { 'content-type': 'audio/webm' } };
  }));
  await openAnswered(page);
  const download = rowOf(page).getByRole('button', { name: /^Download(ing)? the recording of the call from Pak Joko/ });
  await download.focus();
  await page.keyboard.press('Enter');
  await expect(download).toHaveAccessibleName('Downloading the recording of the call from Pak Joko…');
  await expect(download).toBeDisabled();
  await rendered(page);
  await expect(download).toBeFocused();
  const [file] = await Promise.all([page.waitForEvent('download'), slow.open()]);
  expect(file.suggestedFilename()).toBe('call-call-9.webm');
  await expect(toasts(page).getByText('Recording downloaded')).toBeVisible();
  await expect(download).toHaveAccessibleName('Download the recording of the call from Pak Joko');
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
  await openAnswered(page);
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
  await rendered(page); // the press was handled: a Play that went ahead would say it loads by now
  await expect(play).toHaveAccessibleName('Play the recording of the call from Pak Joko');
  await expect(play).toBeDisabled();
  await Promise.all([page.waitForEvent('download'), slow.open()]);
  await expect(play).toBeEnabled();
  expect(asked()).toBe(1); // the download came: a request sent before it would have reached the server
  slow = gate();
  await press(play);
  await expect.poll(asked).toBe(2);
  const loading = row.getByRole('button', { name: /^Loading/ });
  await press(download);
  await rendered(page); // the press was handled: a Download that went ahead would have ended the loading by now
  await expect(loading).toBeDisabled(); // still loading, and says so
  slow.open();
  await expect(row.getByLabel(/^Recording of the call/)).toBeVisible();
  expect(asked()).toBe(2); // the file came: a request sent before it would have reached the server
  await expect(download).toBeFocused(); // the player takes the focus only from Play
});

test('an admin deletes a recording after confirming; the row then says it was deleted', async ({ page, backend }) => {
  let deleted = false;
  listing(backend, () => (deleted ? { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'admin' } } : ANSWERED));
  backend.route(on('DELETE', '/calls/call-9/recording', () => {
    deleted = true;
    return { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } };
  }));
  await openAnswered(page);
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
  await openAnswered(page);
  await deleteRecording(page);
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect.poll(() => focused(page)).toBe('Recording deleted by an admin');
  await expect(toasts(page).getByText('Recording deleted')).toBeVisible();
  await expectAccessible(page, 'ul[aria-label="Calls"]');
});

test('closed without a delete, the dialog gives the focus back to Delete: Cancel, Escape, and a delete that failed', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  const slow = gate();
  backend.route(on('DELETE', '/calls/call-9/recording', async () => {
    await slow.passed;
    return { status: 500, json: { message: 'Internal server error' } };
  }));
  await openAnswered(page);
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
  await expect(toasts(page).getByText('Could not delete the recording')).toBeVisible();
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
  await openAnswered(page);
  await deleteRecording(page);
  const confirm = page.getByRole('alertdialog', { name: 'Delete this recording?' });
  await expect(confirm.getByRole('button', { name: 'Deleting…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await rendered(page); // the key was handled: a dialog it closed says so by now
  await expect(confirm).toHaveAttribute('data-state', 'open');
  slow.open();
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(confirm).toHaveCount(0);
  await expect.poll(() => focused(page)).toBe('Recording deleted by an admin');
});

test('a delete that went through says so, even when the row cannot be read again', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('DELETE', '/calls/call-9/recording', { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } }));
  await openAnswered(page);
  await expect(rowOf(page)).toContainText('Recording 3:10');
  backend.route(on('GET', '/calls/call-9', { status: 500, json: { message: 'Internal server error' } }));
  await deleteRecording(page);
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(rowOf(page).getByRole('button', { name: 'Play' })).toHaveCount(0);
  await expect(page.getByText('Could not delete the recording')).toHaveCount(0);
});

for (const [done, button] of [['played', 'Play'], ['downloaded', 'Download the recording']] as const) {
  test(`a recording its retention removed since the list was read says so once ${done}`, async ({ page, backend }) => {
    listing(backend, () => ANSWERED);
    backend.route(on('GET', '/calls/call-9', { json: { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'retention' } } }));
    backend.route(on('GET', '/calls/call-9/recording', { status: 404, json: { message: 'Recording not found' } }));
    await openAnswered(page);
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
  await openAnswered(page);
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
  listing(backend, () => [ANSWERED, SARI]);
  backend.route(on('GET', /^\/calls\/call-[89]\/recording$/, { body: sineWav(20), headers: { 'content-type': 'audio/wav' } }));
  await openAnswered(page);
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
  await openAnswered(page);
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
  await openAnswered(page);
  await rowOf(page).getByRole('button', { name: 'Play' }).click();
  await expect(rowOf(page).getByRole('button', { name: /^Loading/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  slow.open();
  await ended;
  await rendered(page); // what the page does with an answer is done by now
  expect(await page.evaluate(() => (window as any).__liveBlobs())).toEqual([]);
});

test('a recording that cannot be loaded now (a 503) says why, and Play stays: only a 404 reads the call again', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('GET', '/calls/call-9/recording', { status: 503, json: { message: 'The recordings storage did not answer; try again' } }));
  await openAnswered(page);
  await rowOf(page).getByRole('button', { name: 'Play' }).click();
  await expect(toasts(page).getByRole('listitem').filter({ hasText: 'Could not load the recording' })).toContainText('The recordings storage did not answer; try again');
  await expect(rowOf(page).getByRole('button', { name: 'Play the recording of the call from Pak Joko' })).toBeEnabled();
  expect(backend.requests.filter((r) => r.path === '/calls/call-9').map((r) => r.method)).toEqual([]);
});

test('a browser that cannot play the recording (an older Safari) says so, and offers its download', async ({ page, backend }) => {
  await page.addInitScript(() => {
    const canPlay = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (this: HTMLMediaElement, type: string) {
      return type.startsWith('audio/webm') ? '' : canPlay.call(this, type);
    };
  });
  listing(backend, () => ANSWERED);
  await openAnswered(page);
  const row = rowOf(page);
  await expect(row).toContainText('This browser can’t play this recording: download it');
  await expect(row.getByRole('button', { name: /^Play/ })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Download the recording of the call from Pak Joko' })).toBeVisible();
});

test('a recording the retention removed says so', async ({ page, backend }) => {
  listing(backend, () => ({ ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'retention' } }));
  await openAnswered(page);
  await expect(rowOf(page)).toContainText('Recording deleted after its retention period');
});

/** The call:update sent once the answered call's recording is stored. */
const RECORDING_STORED = {
  profileId: PROFILE.id, callId: 'call-9', waCallId: 'W9', from: ANSWERED.fromJid, isVideo: false, isGroup: false, direction: 'incoming',
  outcome: 'answered', rejectedBy: null, startedAt: ANSWERED.startedAt, endedAt: ANSWERED.endedAt, followUp: 'done', assignedUserId: null,
  answeredByUserId: 'u-jane', answeredAt: ANSWERED.answeredAt, endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 192, hasRecording: true,
};

test('a recording stored after the call shows up without a reload', async ({ page, backend }) => {
  let stored = false;
  listing(backend, () => (stored ? ANSWERED : { ...ANSWERED, recording: null }));
  await openAnswered(page);
  const row = rowOf(page);
  await expect(row).toContainText('Answered by Jane');
  await expect(row).not.toContainText('Recording');
  await expect.poll(() => backend.joined).toContain(PROFILE.id);
  stored = true;
  backend.emitToProfile(PROFILE.id, 'call:update', RECORDING_STORED);
  await expect(row).toContainText('Recording 3:10');
});

test('a call not listed yet whose recording is stored is read once, for its chat and its recording both', async ({ page, backend }) => {
  listing(backend, () => []);
  backend.route(on('GET', '/calls/call-9', { json: ANSWERED }));
  const listed = requestEnded(page, 'outcome=answered');
  await openAnswered(page);
  await listed;
  await expect(page.getByText('No calls here')).toBeVisible(); // the tab's list is in: it does not replace the update's row
  await expect.poll(() => backend.joined).toContain(PROFILE.id);
  backend.emitToProfile(PROFILE.id, 'call:update', RECORDING_STORED);
  const row = rowOf(page); // named after its chat, which only the read has
  await expect(row).toContainText('Recording 3:10');
  expect(backend.requests.filter((r) => r.path === '/calls/call-9').map((r) => r.method)).toEqual(['GET']);
});

const { hasRecording: _, ...CALL_UPDATE } = RECORDING_STORED;
/** The call:update of call-9 while it rings: it has no answer yet, and no recording. */
const RINGING_UPDATE = { ...CALL_UPDATE, outcome: 'ringing', followUp: 'open', endedAt: null, answeredByUserId: null, answeredAt: null, endedBy: null, endReason: null, talkSeconds: null };

test('a call answered live on the Answered tab keeps the chat its ringing read brought: its name, and Open chat', async ({ page, backend }) => {
  listing(backend, () => []);
  backend.route(on('GET', '/calls/call-9', { json: { ...ANSWERED, ...RINGING_UPDATE, id: 'call-9', recording: null, answeredBy: null } }));
  const listed = requestEnded(page, 'outcome=answered');
  await openAnswered(page);
  await listed;
  await expect.poll(() => backend.joined).toContain(PROFILE.id);
  backend.emitToProfile(PROFILE.id, 'call:update', RINGING_UPDATE);
  const strip = page.getByRole('region', { name: 'Ringing now' });
  await expect(strip).toContainText('Pak Joko'); // read once: a call not shown yet
  backend.emitToProfile(PROFILE.id, 'call:update', { ...CALL_UPDATE, endedAt: null, endedBy: null, endReason: null, talkSeconds: null });
  await expect(strip).toHaveCount(0);
  const row = page.getByRole('list', { name: 'Calls', exact: true }).getByRole('listitem');
  await expect(row).toContainText('Answered by');
  await expect(row).toContainText('Pak Joko'); // not the number
  await expect(row.getByRole('link', { name: 'Open chat with Pak Joko' })).toHaveAttribute('href', '/dashboard/chat?profile=p-1&conv=conv-1');
  expect(backend.requests.filter((r) => r.path === '/calls/call-9').map((r) => r.method)).toEqual(['GET']);
});

test('a call not shown yet, read for its chat, takes the recording stored for it too', async ({ page, backend }) => {
  listing(backend, () => []);
  backend.route(on('GET', '/calls/call-9', { json: ANSWERED }));
  const listed = requestEnded(page, 'outcome=answered');
  await openAnswered(page);
  await listed;
  await expect.poll(() => backend.joined).toContain(PROFILE.id);
  backend.emitToProfile(PROFILE.id, 'call:update', { ...CALL_UPDATE, assignedUserId: null }); // a change of an older call, not its recording
  await expect(rowOf(page)).toBeVisible(); // named after its chat: the read is in
  await expect(rowOf(page)).toContainText('Recording 3:10');
});

/** A missed call still to follow up (the Open tab lists it), and a call ringing now. */
const MISSED = { ...ANSWERED, id: 'call-7', waCallId: 'W7', outcome: 'missed', followUp: 'open', recording: null };
const RINGING = {
  ...ANSWERED, id: 'call-8', waCallId: 'W8', fromJid: '628111000222@s.whatsapp.net', outcome: 'ringing', followUp: 'open', endedAt: null,
  conversationId: null, conversation: null, recording: null,
};

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('sees the recording facts, but no player, download or delete', async ({ page, backend }) => {
    listing(backend, () => ANSWERED);
    await openAnswered(page);
    const row = rowOf(page);
    await expect(row).toContainText('Recording 3:10');
    for (const name of ['Play', 'Download the recording', 'Delete the recording']) await expect(row.getByRole('button', { name })).toHaveCount(0);
  });

  test('acts on a call, and assigns it to an agent only: the picker leaves the viewers out', async ({ page, backend }) => {
    listing(backend, () => MISSED);
    backend.route(on('GET', '/organizations/members', { json: [
      { id: ME.id, name: ME.name, email: ME.email, role: 'member', isActive: true },
      { id: 'u-jane', name: 'Jane', email: 'jane@example.com', role: 'admin', isActive: true },
      { id: 'u-vic', name: 'Vic Viewer', email: 'vic@example.com', role: 'viewer', isActive: true },
    ] }));
    await page.goto('/dashboard/calls');
    const row = rowOf(page);
    for (const name of ['Reply', 'Call link', 'Done']) await expect(row.getByRole('button', { name, exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Assign', exact: true }).click();
    await page.getByRole('dialog', { name: 'Assign call' }).getByRole('combobox', { name: 'Assignee' }).click();
    await expect(page.getByRole('option')).toHaveText(['Unassigned', ME.name, 'Jane']);
  });
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('follows the calls, a ringing one too, but takes no action on them', async ({ page, backend }) => {
    listing(backend, () => [MISSED, RINGING]);
    await page.goto('/dashboard/calls');
    await expect(page.getByRole('region', { name: 'Ringing now' })).toContainText('+628111000222');
    await expect(rowOf(page)).toContainText('Missed');
    await expect(rowOf(page).getByRole('link', { name: 'Open chat with Pak Joko' })).toBeVisible();
    for (const name of ['Reject', 'Reply', 'Call link', 'Assign', 'Done', 'Reopen']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
  });
});

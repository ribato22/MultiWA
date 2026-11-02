import { test, expect, on, ME, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { sineWav } from './support/audio';
import type { Page } from '@playwright/test';

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
const rowOf = (page: Page) => page.getByRole('list', { name: 'Calls', exact: true }).getByRole('listitem').filter({ hasText: 'Pak Joko' });

test('an answered call shows who answered, how fast, the talk time and its recording, with a player for an admin', async ({ page, backend }) => {
  listing(backend, () => ANSWERED);
  backend.route(on('GET', '/calls/call-9/recording', { body: sineWav(2), headers: { 'content-type': 'audio/wav' } }));
  await page.goto('/dashboard/calls');
  const row = rowOf(page);
  await expect(row.getByText('Answered', { exact: true })).toBeVisible();
  await expect(row).toContainText('Answered by Jane · 6 s to answer · Talk 3:12');
  await expect(row).toContainText('Recording 3:10');
  await expect(row).toContainText('Partial');
  await row.getByRole('button', { name: 'Play' }).click();
  const audio = row.getByLabel('Recording of the call with Pak Joko');
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
  const [download] = await Promise.all([page.waitForEvent('download'), rowOf(page).getByRole('button', { name: 'Download the recording' }).click()]);
  expect(download.suggestedFilename()).toBe('call-call-9.webm');
  const asked = backend.requests.find((r) => r.path === '/calls/call-9/recording' && r.query.get('download') === '1');
  expect(asked?.headers.authorization).toBe('Bearer test-token');
});

test('an admin deletes a recording after confirming; the row then says it was deleted', async ({ page, backend }) => {
  let deleted = false;
  listing(backend, () => (deleted ? { ...ANSWERED, recording: { ...REC, deletedAt: NOW, deleteReason: 'admin' } } : ANSWERED));
  backend.route(on('DELETE', '/calls/call-9/recording', () => {
    deleted = true;
    return { json: { callId: 'call-9', recordingId: 'rec-9', deletedAt: NOW } };
  }));
  await page.goto('/dashboard/calls');
  await rowOf(page).getByRole('button', { name: 'Delete the recording' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this recording?' });
  await expect(confirm).toContainText('Pak Joko');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(rowOf(page)).toContainText('Recording deleted by an admin');
  await expect(confirm).toHaveCount(0);
  await expect(rowOf(page).getByRole('button', { name: 'Play' })).toHaveCount(0);
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

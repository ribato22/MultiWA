// The pictures of docs/23-calls.md, taken from the fake backend's made-up data. Not a test: CI skips it. After a change
// to these screens, run it again, look at each picture, then `pnpm sync:docsite` copies them for the docs site:
//   DOCS_SCREENSHOTS=1 pnpm --filter admin test:e2e e2e/docs-screenshots.spec.ts
import { statSync } from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, get, ringing, PROFILE, STATUS } from './support/fixtures';

test.skip(!process.env.DOCS_SCREENSHOTS, 'writes the docs screenshots: set DOCS_SCREENSHOTS=1');
// One size for every picture, whatever the config's default becomes.
test.use({ viewport: { width: 1280, height: 800 } });

const OUT = path.resolve(__dirname, '../../../docs/screenshots/calls');

/** The element alone, without its animations or the caret, as a small PNG. */
async function shoot(target: Locator, name: string) {
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  expect(statSync(file).size, `${name}.png is small`).toBeLessThan(150_000);
}

/** One microphone, named as a browser names a headset, in use for the call. */
const headset = () => {
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await gum(constraints);
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...settings(), deviceId: 'mic-headset' });
    return stream;
  };
  navigator.mediaDevices.enumerateDevices = async () =>
    [{ deviceId: 'mic-headset', kind: 'audioinput', label: 'Headset', groupId: 'g1', toJSON() { return this; } }] as MediaDeviceInfo[];
};

test('the incoming-call banner', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing({ recorded: true }));
  const banner = page.getByRole('region', { name: 'Incoming calls' });
  await expect(banner.getByRole('button', { name: 'Answer' })).toBeEnabled();
  await shoot(banner, 'incoming-call');
});

test('the in-call bar', async ({ page, context, backend }) => {
  await context.addInitScript(headset);
  await context.addInitScript(() => {
    // A good link: the round trip the server reports for the agent's voice, and the caller's packets arriving.
    let received = 0;
    RTCPeerConnection.prototype.getStats = async () =>
      new Map([
        ['out', { type: 'remote-inbound-rtp', roundTripTime: 0.05, fractionLost: 0, jitter: 0.004 }],
        ['in', { type: 'inbound-rtp', kind: 'audio', jitter: 0.004, packetsLost: 0, packetsReceived: (received += 100) }],
      ]) as unknown as RTCStatsReport;
  });
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing({ recorded: true }));
  await page.getByRole('region', { name: 'Incoming calls' }).getByRole('button', { name: 'Answer' }).click();
  const bar = page.getByRole('group', { name: 'Current call' });
  await expect(bar).toBeVisible();
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 83_000).toISOString() });
  await expect(bar).toContainText('Network quality: Good');
  await expect(bar.getByRole('combobox', { name: 'Microphone' })).toHaveText('Headset');
  await shoot(page.locator('header'), 'in-call-bar');
});

test('Settings → Calls', async ({ page, context }) => {
  await context.addInitScript(headset);
  await page.goto('/dashboard/settings?tab=calls');
  const section = page.getByRole('region', { name: 'Calls in this browser' });
  await expect(section).toContainText('Microphone: Allowed');
  await expect(section.getByRole('combobox', { name: 'Microphone' })).toHaveText('Headset');
  await expect(section).toContainText('Desktop alerts are on');
  await shoot(section, 'settings-calls');
});

test('the profile’s Calls section', async ({ page, backend }) => {
  const ready = { answerInDashboard: true, recording: true, retentionDays: 30, announcement: { mimeType: 'audio/mpeg', durationSec: 6.2 } };
  backend.route(get('/calls/media/status', { ...STATUS, profiles: [{ ...STATUS.profiles[0], ...ready }] }));
  await page.goto(`/dashboard/profiles/${PROFILE.id}`);
  const section = page.getByRole('region', { name: 'Calls', exact: true });
  await expect(section).toContainText('This profile can take calls in the dashboard');
  await expect(section).toContainText('mp3 · 6.2 s');
  await shoot(section, 'profile-calls');
});

test('the Calls page: an answered call and its recording', async ({ page, backend }) => {
  const answered = {
    id: 'call-9', profileId: PROFILE.id, waCallId: 'W9', fromJid: '628111000111@s.whatsapp.net', isVideo: false, isGroup: false,
    direction: 'incoming', outcome: 'answered', rejectedBy: null, startedAt: '2026-11-01T03:00:00.000Z', endedAt: '2026-11-01T03:03:18.000Z',
    followUp: 'done', assignedUserId: null, conversationId: 'conv-1', answeredByUserId: 'u-jane', answeredAt: '2026-11-01T03:00:06.000Z',
    endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 192, assignedUser: null, answeredBy: { id: 'u-jane', name: 'Jane' },
    conversation: { id: 'conv-1', name: 'Pak Joko' },
    recording: { id: 'rec-9', durationSec: 190, bytes: 95_000, partial: false, announcementPlayed: true, createdAt: '2026-11-01T03:03:20.000Z', deletedAt: null, deleteReason: null },
  };
  // The list as the server filters it (the Answered tab asks for outcome=answered), and the call by its id.
  backend.route((r) => {
    if (r.method !== 'GET' || r.path !== '/calls') return undefined;
    const [outcome, followUp] = [r.query.get('outcome'), r.query.get('followUp')];
    const calls = [answered].filter((c) => (!outcome || c.outcome === outcome) && (!followUp || c.followUp === followUp));
    return { json: { calls, nextCursor: null } };
  });
  backend.route(get(`/calls/${answered.id}`, answered));
  await page.goto('/dashboard/calls');
  await page.getByRole('tab', { name: 'Answered' }).click();
  const row = page.getByRole('list', { name: 'Calls', exact: true }).getByRole('listitem').filter({ hasText: 'Pak Joko' });
  await expect(row).toContainText('Answered by Jane · 6 s to answer · Talk 3:12');
  await expect(row).toContainText('Recording 3:10');
  await shoot(row, 'calls-page-recording');
});

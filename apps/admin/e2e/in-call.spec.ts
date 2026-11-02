import { test, expect, ringing, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const bar = (page: Page) => page.getByRole('group', { name: 'Current call' });
async function open(page: Page) {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
}
async function answer(page: Page, backend: FakeBackend, over: Record<string, unknown> = {}) {
  backend.emit('call:ringing', ringing(over));
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toBeVisible();
}
const senderTracks = (page: Page) =>
  page.evaluate(() =>
    (window as any).__pcs
      .flatMap((pc: RTCPeerConnection) => pc.getSenders())
      .filter((s: RTCRtpSender) => s.track)
      .map((s: RTCRtpSender) => ({ id: s.track!.id, enabled: s.track!.enabled })),
  );
const ops = (backend: FakeBackend) => backend.commands('call:media').map((a) => (a.op === 'createTransport' ? `createTransport:${a.direction}` : a.op));

test('focus goes to Answer when a call rings, unless the agent is typing in a field', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await page.evaluate(() => {
    const input = Object.assign(document.createElement('input'), { id: 'typing' });
    input.setAttribute('aria-label', 'A message being typed');
    document.body.append(input);
    input.focus();
  });
  backend.emit('call:ringing', ringing({ callId: 'call-2' }));
  await expect(banner(page)).toBeVisible();
  await expect(page.locator('#typing')).toBeFocused();
});

test('Answer opens the microphone, claims the call, connects its audio in the order the server expects, then shows the call', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend, { recorded: true });
  await expect(bar(page)).toContainText('Connecting…');
  expect(backend.commands('call:answer')).toEqual([{ callId: 'call-1' }]);
  await expect
    .poll(() => ops(backend))
    .toEqual(['rtpCapabilities', 'createTransport:recv', 'consume', 'connectTransport', 'resumeConsumer', 'createTransport:send', 'connectTransport', 'produce']);
  backend.emit('call:announcing', { callId: 'call-1', durationSec: 6.2 });
  await expect(bar(page)).toContainText('The caller hears the recording notice');
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 5_000).toISOString() });
  await expect(bar(page).getByRole('timer', { name: 'Call time' })).toHaveText(/^0:0[5-8]$/);
  await expect(bar(page)).toContainText('Recording');
  await expect(page.getByRole('group', { name: 'Calls availability' })).toContainText('On a call');
  await expect(bar(page).getByRole('button', { name: 'Hang up' })).toBeFocused(); // the Answer it replaced had the focus
  await expectAccessible(page, '[aria-label="Current call"]');
});

test('a microphone the browser refuses stops the answer before any claim', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await open(page);
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(banner(page)).toContainText('Allow the microphone for this site to answer calls');
  expect(backend.commands('call:answer')).toEqual([]);
});

test('signing out while the microphone opens closes it at once, and claims nothing', async ({ page, backend }) => {
  await open(page);
  // The microphone opens when the test says so, as when the browser asks the agent first.
  await page.evaluate(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => new Promise((resolve) => (w.__openMic = () => gum(c).then((s) => resolve((w.__mic = s)))));
  });
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).press('Enter'); // the banner floats over the menu
  await expect(page).toHaveURL(/\/auth\/login$/); // a client navigation: the console is gone, this page is not
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => page.evaluate(() => (window as any).__mic.getAudioTracks()[0].readyState)).toBe('ended');
  expect(backend.commands('call:answer')).toEqual([]);
});

test('an answer the server refuses says why, and the card fades', async ({ page, backend }) => {
  backend.reply('call:answer', () => ({ ok: false, reason: 'already_claimed' }));
  await open(page);
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(banner(page)).toContainText('Someone else answered');
  await expect(bar(page)).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0, { timeout: 6000 });
});

test('Mute silences the microphone track while the call stays connected', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect.poll(async () => (await senderTracks(page)).map((t) => t.enabled)).toEqual([true]);
  const mute = bar(page).getByRole('button', { name: 'Mute' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await senderTracks(page)).map((t) => t.enabled)).toEqual([false]);
  await mute.click();
  await expect.poll(async () => (await senderTracks(page)).map((t) => t.enabled)).toEqual([true]);
  expect(backend.commands('call:hangup')).toEqual([]);
});

test('the microphone can be switched mid-call, and the choice is kept for the next call', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    // Two microphones; Chrome's fake device stands in for both.
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__asked = [];
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      (window as any).__asked.push(JSON.stringify(c));
      return gum({ audio: true });
    };
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        { deviceId: 'mic-a', kind: 'audioinput', label: 'Desk microphone', groupId: 'g1', toJSON() { return this; } },
        { deviceId: 'mic-b', kind: 'audioinput', label: 'Headset', groupId: 'g2', toJSON() { return this; } },
      ] as MediaDeviceInfo[];
  });
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect.poll(async () => (await senderTracks(page)).length).toBe(1);
  const [before] = await senderTracks(page);
  await bar(page).getByRole('combobox', { name: 'Microphone' }).click();
  await page.getByRole('option', { name: 'Headset' }).click();
  await expect.poll(async () => (await senderTracks(page))[0]?.id).not.toBe(before.id);
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:mic'))).toBe('mic-b');
  expect(await page.evaluate(() => (window as any).__asked.at(-1))).toContain('"exact":"mic-b"');
});

test('Hang up waits for the server, up to half a minute on a recorded call, then says how it ended', async ({ page, backend }) => {
  await page.clock.install();
  let release!: () => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (release = () => resolve({ ok: true }))));
  await open(page);
  await answer(page, backend, { recorded: true });
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const hangUp = bar(page).getByRole('button', { name: 'Hang up' });
  await hangUp.click();
  await expect(hangUp).toBeDisabled();
  await expect(bar(page)).toContainText('Hanging up…');
  await page.clock.runFor(29_000); // the recorder's stop, then the media's close, at worst
  await expect(bar(page)).toContainText('Hanging up…');
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'agent', endReason: 'hangup', talkSeconds: 42 });
  release();
  await expect(bar(page)).toContainText('You hung up · 0:42');
  await page.clock.runFor(5_000);
  await expect(bar(page)).toHaveCount(0);
});

test('the caller hanging up ends the call here and closes its audio', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 7 });
  await expect(bar(page)).toContainText('The caller hung up · 0:07');
  await expect.poll(() => page.evaluate(() => (window as any).__pcs.every((pc: RTCPeerConnection) => pc.connectionState === 'closed'))).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('multiwa:call'))).toBeNull();
});

test('audio this browser cannot connect gives the call back, so it rings for the others', async ({ page, backend }) => {
  backend.reply('call:media', (a) =>
    a.op === 'consume' ? { ok: false, reason: 'media_error', message: 'Cannot consume this producer with these capabilities' } : backend.defaults['call:media'](a),
  );
  await open(page);
  await answer(page, backend);
  await expect.poll(() => backend.commands('call:hangup')).toEqual([{ callId: 'call-1' }]);
  await expect(bar(page)).toContainText('Could not connect audio');
});

test('an answer whose audio did not connect in time says so', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:ended', { callId: 'call-1', endReason: 'media_failed' });
  await expect(bar(page)).toContainText('Could not connect audio');
});

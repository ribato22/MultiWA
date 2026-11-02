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
const produced = (backend: FakeBackend) => backend.commands('call:media').filter((a) => a.op === 'produce').length;
/** The microphone tracks this page opened, and whether each is still live. */
const micStates = (page: Page) => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState));
/** The peer connections still open (a closed one's signalingState is `closed`). */
const openPeers = (page: Page) => page.evaluate(() => (window as any).__pcs.filter((pc: RTCPeerConnection) => pc.signalingState !== 'closed').length);
/** Every microphone this page opens is recorded in `__micTracks`. */
const recordMics = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    w.__micTracks = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await gum(c);
      w.__micTracks.push(...stream.getAudioTracks());
      return stream;
    };
  });

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
  await expect(bar(page)).toBeFocused(); // the Answer it replaced had the focus: the call has it, not Hang up
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
  await page.getByRole('menuitem', { name: 'Sign out' }).click(); // the menu is over the banner
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
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('multiwa:call')))).toEqual([]);
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

test('Mute pressed while the audio connects holds once it is connected', async ({ page, backend }) => {
  // The agent's voice is produced when the test says so, as on a slow link.
  let release!: () => void;
  backend.reply('call:media', (a) =>
    a.op === 'produce' ? new Promise((resolve) => (release = () => resolve(backend.defaults['call:media'](a)))) : backend.defaults['call:media'](a),
  );
  await open(page);
  await answer(page, backend);
  await expect.poll(() => produced(backend)).toBe(1);
  await expect(bar(page)).toContainText('Connecting…');
  const mute = bar(page).getByRole('button', { name: 'Mute' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  release();
  await expect.poll(async () => (await senderTracks(page)).map((t) => t.enabled)).toEqual([false]);
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
});

test('a call:active naming another producer means another tab or browser of the agent took the call: this tab lets go, of audio still connecting too; its own keeps the audio', async ({ page, backend }) => {
  // The first voice is produced when the test says so: the call moves while this tab's audio still connects.
  let release: (() => void) | undefined;
  backend.reply('call:media', (a) => {
    if (a.op !== 'produce' || release) return backend.defaults['call:media'](a);
    return new Promise((resolve) => (release = () => resolve(backend.defaults['call:media'](a))));
  });
  await open(page);
  await recordMics(page);
  await answer(page, backend, { recorded: true });
  await expect.poll(() => produced(backend)).toBe(1);
  // The agent took the call in another browser during the announcement: the server connects that browser's voice.
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'producer-elsewhere' });
  await expect(bar(page)).toContainText('On a call in another tab');
  release!();
  await expect.poll(() => micStates(page)).toEqual(['ended']);
  await expect.poll(() => openPeers(page)).toBe(0);
  // And back here: this tab's own call:active keeps the audio it built.
  await bar(page).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => produced(backend)).toBe(2);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'agent-producer' });
  await expect(bar(page).getByRole('timer', { name: 'Call time' })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
  await expect.poll(() => openPeers(page)).toBe(2);
  expect(await micStates(page)).toEqual(['ended', 'live']);
  await expect(bar(page)).not.toContainText('On a call in another tab');
});

test('Hang up silences the microphone at once; a hang-up that fails gives the agent back their own mute', async ({ page, backend }) => {
  let reply!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (reply = resolve)));
  await open(page);
  await answer(page, backend, { recorded: true });
  await expect.poll(() => produced(backend)).toBe(1);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() }); // once the voice is produced, as the server does
  await expect(bar(page).getByRole('timer', { name: 'Call time' })).toBeVisible();
  const enabled = async () => (await senderTracks(page)).map((t) => t.enabled);
  await expect.poll(enabled).toEqual([true]);
  const hangUp = bar(page).getByRole('button', { name: 'Hang up' });
  const mute = bar(page).getByRole('button', { name: 'Mute' });
  // A recorded call's hang-up can take half a minute: nothing the agent says meanwhile reaches the caller or the recording.
  await hangUp.click();
  await expect(bar(page)).toContainText('Hanging up…');
  await expect.poll(enabled).toEqual([false]);
  await expect.poll(() => backend.commands('call:hangup').length).toBe(1);
  reply({ ok: false, reason: 'error' });
  await expect(hangUp).toBeEnabled();
  await expect(bar(page)).toContainText('The hang-up did not go through: try again');
  await expect.poll(enabled).toEqual([true]); // unmuted, as the agent left it
  await mute.click();
  await expect.poll(enabled).toEqual([false]);
  await hangUp.click();
  await expect.poll(() => backend.commands('call:hangup').length).toBe(2);
  reply({ ok: false, reason: 'error' });
  await expect(hangUp).toBeEnabled();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(await enabled()).toEqual([false]); // still muted
});

test('Enter on Answer, then Enter again, does not hang up: the focus goes to the call, not to Hang up', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-label="Current call"]'))).toBe(true);
  await page.keyboard.press('Enter'); // the agent pressed it twice
  await expect(bar(page)).toBeFocused();
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(bar(page).getByRole('timer', { name: 'Call time' })).toBeVisible();
  expect(backend.commands('call:hangup')).toEqual([]);
});

test('the recording notice counts down on the bar, but the live region does not say every second', async ({ page, backend }) => {
  await page.clock.install();
  await open(page);
  await answer(page, backend, { recorded: true });
  backend.emit('call:announcing', { callId: 'call-1', durationSec: 6.2 });
  const status = bar(page).getByRole('status');
  await expect(status).toContainText('The caller hears the recording notice');
  const said = await status.textContent();
  const shown = await bar(page).textContent();
  await page.clock.runFor(2_000);
  await expect.poll(() => bar(page).textContent()).not.toBe(shown); // the seconds go down
  expect(await status.textContent()).toBe(said);
  await expectAccessible(page, '[aria-label="Current call"]');
});

test('the microphone list shows the one in use, and follows a microphone plugged in', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    // The browser opened the headset, with no choice stored (its default microphone).
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = await gum({ audio: true });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: 'mic-b' });
      return stream;
    };
    const device = (deviceId: string, label: string) => ({ deviceId, kind: 'audioinput', label, groupId: deviceId, toJSON() { return this; } });
    w.__devices = [device('mic-a', 'Desk microphone'), device('mic-b', 'Headset')];
    w.__plugIn = () => {
      w.__devices.push(device('mic-c', 'USB microphone'));
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    };
    navigator.mediaDevices.enumerateDevices = async () => w.__devices as MediaDeviceInfo[];
  });
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const picker = bar(page).getByRole('combobox', { name: 'Microphone' });
  await expect(picker).toHaveText('Headset');
  await page.evaluate(() => (window as any).__plugIn());
  await picker.click();
  await expect(page.getByRole('option')).toHaveText(['Desk microphone', 'Headset', 'USB microphone']);
});

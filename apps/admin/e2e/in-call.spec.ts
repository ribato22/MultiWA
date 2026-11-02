import { test, expect, gate, rendered, ringing, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Locator, Page } from '@playwright/test';

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
/** Whether each microphone this page opened is enabled (recordMics). */
const micEnabled = (page: Page) => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.enabled));
/** The call's audio is built: the caller plays in the console's hidden <audio>. */
const built = (page: Page) => page.evaluate(() => !!(document.querySelector('audio[hidden]') as HTMLAudioElement | null)?.srcObject);
/** `call:media` with each op in `ops` held until the test calls `held[op]()`, as on a slow link. */
const holdMedia = (backend: FakeBackend, ...ops: string[]) => {
  const held: Record<string, () => void> = {};
  backend.reply('call:media', (a) =>
    ops.includes(a.op) ? new Promise((resolve) => (held[a.op] = () => resolve(backend.defaults['call:media'](a)))) : backend.defaults['call:media'](a),
  );
  return held;
};
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

test('Answer keeps the focus while it connects; an answer the server refuses hands it to its card, which says why', async ({ page, backend }) => {
  let refuse!: () => void;
  backend.reply('call:answer', () => new Promise((resolve) => (refuse = () => resolve({ ok: false, reason: 'already_claimed' }))));
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => backend.commands('call:answer')).toHaveLength(1);
  const connecting = banner(page).getByRole('button', { name: 'Connecting…' });
  await expect(connecting).toBeDisabled();
  await rendered(page);
  await expect(connecting).toBeFocused();
  await page.keyboard.press('Enter'); // pressed again while it connects
  refuse();
  const card = banner(page).getByRole('group', { name: 'Call from Pak Joko' });
  await expect(card.getByRole('alert')).toContainText('Someone else answered');
  await expect(card).toBeFocused();
  expect(backend.commands('call:answer')).toHaveLength(1);
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

test('Mute pressed while the audio connects silences the microphone at once, and nothing in the build turns it back on', async ({ page, backend }) => {
  const held = holdMedia(backend, 'resumeConsumer', 'produce');
  await open(page);
  await recordMics(page);
  await answer(page, backend);
  await expect.poll(() => !!held.resumeConsumer).toBe(true);
  await expect(bar(page)).toContainText('Connecting…');
  expect(await micEnabled(page)).toEqual([true]);
  const mute = bar(page).getByRole('button', { name: 'Mute' });
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(await micEnabled(page)).toEqual([false]); // nothing is produced yet
  held.resumeConsumer();
  await expect.poll(() => produced(backend)).toBe(1);
  expect(await micEnabled(page)).toEqual([false]); // the voice is produced paused
  held.produce();
  await expect.poll(() => built(page)).toBe(true);
  expect((await senderTracks(page)).map((t) => t.enabled)).toEqual([false]);
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await expect.poll(() => micEnabled(page)).toEqual([true]);
});

test('Hang up while the audio connects silences the microphone at once, and the audio built meanwhile stays silent', async ({ page, backend }) => {
  const held = holdMedia(backend, 'produce');
  let hungUp!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (hungUp = resolve)));
  await open(page);
  await recordMics(page);
  await answer(page, backend);
  await expect.poll(() => produced(backend)).toBe(1);
  expect(await micEnabled(page)).toEqual([true]);
  await bar(page).getByRole('button', { name: 'Hang up' }).click();
  await expect(bar(page)).toContainText('Hanging up…');
  expect(await micEnabled(page)).toEqual([false]); // the voice is not produced yet
  held.produce();
  await expect.poll(() => built(page)).toBe(true);
  expect((await senderTracks(page)).map((t) => t.enabled)).toEqual([false]);
  await expect.poll(() => backend.commands('call:hangup')).toHaveLength(1);
  hungUp({ ok: true });
  await expect(bar(page)).toContainText('You hung up');
  await expect.poll(() => micStates(page)).toEqual(['ended']);
});

test('the end of a call whose audio still connects ends its microphone at once, and its audio once the build gives up', async ({ page, backend }) => {
  const held = holdMedia(backend, 'produce');
  await open(page);
  await recordMics(page);
  await answer(page, backend);
  await expect.poll(() => produced(backend)).toBe(1);
  backend.emit('call:ended', { callId: 'call-1', endReason: 'media_failed' }); // the server gave it up: its connect timer
  await expect(bar(page)).toContainText('Could not connect audio');
  await expect.poll(() => micStates(page)).toEqual(['ended']); // the voice's produce has not returned
  expect(await openPeers(page)).toBe(2);
  held.produce();
  await expect.poll(() => openPeers(page)).toBe(0);
  expect(await built(page)).toBe(false);
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

// Where the focus goes when the call console lets go of it. The agent was on a link of the page (not a field, where no
// ring takes the focus) when the call rang.
const working = (page: Page) => page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Chat', exact: true });
const card = (page: Page, caller: string) => banner(page).getByRole('group', { name: `Call from ${caller}` });
const SARI = { callId: 'call-2', caller: { name: 'Bu Sari', number: '628111000222' } };
async function ringFrom(page: Page, backend: FakeBackend) {
  await working(page).focus();
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
}

test('a call that stops ringing gives the focus back to where the ring took it from', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
  await expect(working(page)).toBeFocused();
});

test('Dismiss pressed with the keyboard gives the focus back to where the ring took it from', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  await page.keyboard.press('Tab');
  await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(banner(page)).toHaveCount(0);
  await expect(working(page)).toBeFocused();
});

test('a call another agent answers gives the focus back at once, while its card says who', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  backend.emit('call:claimed', { callId: 'call-1', byUserId: 'u-jane', byUserName: 'Jane' });
  await expect(banner(page)).toContainText('Answered by Jane');
  await expect(working(page)).toBeFocused();
});

test('a failed answer’s card keeps the focus while it says why, and gives it back as it fades', async ({ page, backend }) => {
  backend.reply('call:answer', () => ({ ok: false, reason: 'already_claimed' }));
  await open(page);
  await ringFrom(page, backend);
  await page.keyboard.press('Enter');
  await expect(card(page, 'Pak Joko').getByRole('alert')).toContainText('Someone else answered');
  await expect(card(page, 'Pak Joko')).toBeFocused();
  await expect(banner(page)).toHaveCount(0, { timeout: 6000 });
  await expect(working(page)).toBeFocused();
});

test('nothing to give the focus back to: it goes to the main content, not to the page; only then can the main content take it', async ({ page, backend }) => {
  await open(page); // nothing has the focus
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(banner(page)).toHaveCount(0);
  const main = page.getByRole('main');
  await expect(main).toBeFocused();
  expect(await main.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgba(0, 0, 0, 0)'); // no ring around the page
  // Once the focus moved on, a click beside every control (a header menu's text) focuses nothing again: the page.
  await page.keyboard.press('Tab');
  await expect(main).not.toHaveAttribute('tabindex');
  await page.getByRole('heading', { name: 'Calls', exact: true }).click();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('two calls ringing: the card that goes with the focus hands it to the other call’s Answer, and the last one gives it back', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  backend.emit('call:ringing', ringing(SARI));
  await expect(card(page, 'Bu Sari').getByRole('button', { name: 'Answer' })).toBeFocused();
  await card(page, 'Pak Joko').getByRole('button', { name: 'Answer' }).focus(); // the agent goes to the older call
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(card(page, 'Pak Joko')).toHaveCount(0);
  await expect(card(page, 'Bu Sari').getByRole('button', { name: 'Answer' })).toBeFocused();
  backend.emit('call:ended', { callId: 'call-2', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
  await expect(working(page)).toBeFocused();
});

test('two calls ringing: a card that goes without the focus leaves it where the agent put it', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  backend.emit('call:ringing', ringing(SARI));
  await expect(card(page, 'Bu Sari').getByRole('button', { name: 'Answer' })).toBeFocused();
  const messages = page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Messages', exact: true });
  await messages.focus(); // back to the page
  backend.emit('call:ended', { callId: 'call-2', outcome: 'missed' });
  await expect(card(page, 'Bu Sari')).toHaveCount(0);
  await page.waitForTimeout(300); // the console's effects have run
  await expect(messages).toBeFocused();
});

test('two calls ringing: Enter on the newest keeps the focus on it while it connects, then the call has it; Enter again answers nothing else', async ({ page, backend }) => {
  const slow = gate();
  backend.reply('call:answer', async (a) => {
    await slow.passed;
    return backend.defaults['call:answer'](a);
  });
  await open(page);
  await ringFrom(page, backend);
  backend.emit('call:ringing', ringing(SARI));
  await expect(card(page, 'Bu Sari').getByRole('button', { name: 'Answer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => backend.commands('call:answer')).toEqual([{ callId: 'call-2' }]);
  const connecting = card(page, 'Bu Sari').getByRole('button', { name: 'Connecting…' });
  await rendered(page);
  await expect(connecting).toBeFocused();
  await page.keyboard.press('Enter'); // pressed again while it connects
  slow.open();
  await expect(bar(page)).toContainText('Bu Sari');
  await expect(bar(page)).toBeFocused();
  await page.waitForTimeout(300); // a second answer would be out by now
  expect(backend.commands('call:answer')).toEqual([{ callId: 'call-2' }]);
  await expect(card(page, 'Pak Joko').getByRole('button', { name: 'Answer' })).toBeVisible(); // it still rings, quiet
});

test('a call that rings while this tab answers another takes no focus: the call being answered keeps it, then its bar', async ({ page, backend }) => {
  const slow = gate();
  backend.reply('call:answer', async (a) => {
    await slow.passed;
    return backend.defaults['call:answer'](a);
  });
  await open(page);
  await ringFrom(page, backend);
  await page.keyboard.press('Enter');
  await expect.poll(() => backend.commands('call:answer')).toEqual([{ callId: 'call-1' }]);
  backend.emit('call:ringing', ringing(SARI)); // it rang before the server had this agent's claim
  await expect(card(page, 'Bu Sari')).toBeVisible();
  await rendered(page);
  await expect(card(page, 'Pak Joko').getByRole('button', { name: 'Connecting…' })).toBeFocused();
  slow.open();
  await expect(bar(page)).toBeFocused();
});

test('Hang up keeps the focus while it hangs up, then gives it back to where the ring took it from', async ({ page, backend }) => {
  let release!: () => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (release = () => resolve({ ok: true }))));
  await open(page);
  await ringFrom(page, backend);
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeFocused();
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const hangUp = bar(page).getByRole('button', { name: 'Hang up' });
  await hangUp.focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toContainText('Hanging up…');
  await expect(hangUp).toBeDisabled();
  await rendered(page);
  await expect(hangUp).toBeFocused();
  await page.keyboard.press('Enter'); // pressed again meanwhile
  await expect.poll(() => backend.commands('call:hangup')).toHaveLength(1);
  release();
  await expect(bar(page)).toContainText('You hung up');
  await expect(working(page)).toBeFocused();
});

test('a call the caller ends keeps the focus on its bar while it says so, and gives it back once the bar goes', async ({ page, backend }) => {
  await open(page);
  await ringFrom(page, backend);
  await page.keyboard.press('Enter');
  await expect(bar(page)).toBeFocused();
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 7 });
  await expect(bar(page)).toContainText('The caller hung up · 0:07');
  await expect(bar(page)).toBeFocused();
  await expect(bar(page)).toHaveCount(0, { timeout: 6000 });
  await expect(working(page)).toBeFocused();
});

/**
 * Puts the page behind another tab, for real: Playwright's focus emulation goes off (a reload turns it back on), and the
 * other tab takes the browser's focus. Chrome fires no focus event in a page without it: `.focus()` there moves the
 * focus silently, and the page fires one only once it is back (`back()`).
 */
async function behindAnotherTab(page: Page) {
  await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await (await page.context().newPage()).bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
  return async function back() {
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  };
}
/** Whether the element has the page's focus, though the page may not have the browser's (toBeFocused needs both). */
const holds = (l: Locator) => l.evaluate((el) => el === document.activeElement);

test('a call that rings and stops behind another tab gives the focus back to where the ring took it from', async ({ page, backend }) => {
  await open(page);
  await working(page).focus();
  const back = await behindAnotherTab(page);
  backend.emit('call:ringing', ringing());
  await expect.poll(() => holds(banner(page).getByRole('button', { name: 'Answer' }))).toBe(true);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
  await back();
  await expect(working(page)).toBeFocused();
});

test('a call that rang behind another tab and stops once the agent is back gives the focus back to where the ring took it from', async ({ page, backend }) => {
  await open(page);
  await working(page).focus();
  const back = await behindAnotherTab(page);
  backend.emit('call:ringing', ringing());
  const answerButton = banner(page).getByRole('button', { name: 'Answer' });
  await expect.poll(() => holds(answerButton)).toBe(true);
  await back(); // the page gets the focus event only now, from nowhere
  await expect(answerButton).toBeFocused();
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
  await expect(working(page)).toBeFocused();
});

test('a call a reload rejoined behind another tab gives the focus to the main content once its bar goes, not to the page', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  page.on('dialog', (d) => void d.accept()); // the leave-page warning
  backend.offline = true; // the reload's socket waits, so the rejoin comes once the page is behind the other tab
  await page.reload();
  const back = await behindAnotherTab(page);
  backend.offline = false;
  await expect.poll(() => holds(bar(page)), { timeout: 15_000 }).toBe(true); // the rejoined call, as after any reload
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 7 });
  await expect(bar(page)).toHaveCount(0, { timeout: 10_000 });
  await back();
  await expect(page.getByRole('main')).toBeFocused();
});

test('the main content keeps the focus it was given while the page is behind another tab, and gives it up to a ring there', async ({ page, backend }) => {
  await open(page); // nothing has the focus
  backend.emit('call:ringing', ringing());
  const answerButton = banner(page).getByRole('button', { name: 'Answer' });
  await expect(answerButton).toBeFocused();
  await page.keyboard.press('Escape');
  const main = page.getByRole('main');
  await expect(main).toBeFocused();
  let back = await behindAnotherTab(page);
  await back();
  await rendered(page); // Chrome moves the focus off an element that can no longer take it when it renders
  await expect(main).toBeFocused();
  await expect(main).toHaveAttribute('tabindex', '-1');
  // Behind another tab again, a ring moves the focus with no event: the main content can no longer take it all the same.
  back = await behindAnotherTab(page);
  backend.emit('call:ringing', ringing({ callId: 'call-2' }));
  await expect.poll(() => holds(answerButton)).toBe(true);
  await expect(main).not.toHaveAttribute('tabindex');
  backend.emit('call:ended', { callId: 'call-2', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
  await back();
  await expect(main).toBeFocused();
});

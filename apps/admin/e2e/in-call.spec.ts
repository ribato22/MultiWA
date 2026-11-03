import { test, expect, gate, get, rendered, ringing, PROFILE, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { holdMics } from './support/browser';
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
/** Settles once nothing in `l` animates any more: what it shows then is what the agent reads. */
const settled = (l: Locator) => expect.poll(() => l.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
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
  await expectAccessible(page, '[aria-label="Incoming calls"]');
  await page.keyboard.press('Enter'); // pressed again while it connects
  refuse();
  const card = banner(page).getByRole('group', { name: 'Call from Pak Joko' });
  await expect(card.getByRole('alert')).toContainText('Someone else answered');
  await expect(card).toBeFocused();
  expect(backend.commands('call:answer')).toHaveLength(1);
  await settled(card);
  await expectAccessible(page, '[aria-label="Incoming calls"]'); // as it fades too
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

test('a call that stops ringing while Answer opens the microphone says so on its card, which keeps the focus, then fades', async ({ page, context, backend }) => {
  await holdMics(context);
  backend.reply('call:answer', () => ({ ok: false, reason: 'not_ringing' })); // as the server answers for a call that stopped ringing
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' }); // the caller hung up
  const c = card(page, 'Pak Joko');
  await expect(c.getByRole('alert')).toHaveText('The call is no longer ringing');
  await expect(c).toBeFocused();
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState))).toEqual(['ended']);
  await expect(c.getByRole('alert')).toHaveText('The call is no longer ringing');
  await expect(banner(page)).toHaveCount(0, { timeout: 6000 });
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

test('an answer or a change of availability on a socket the server could not check says to try again in a moment', async ({ page, backend }) => {
  backend.reply('call:answer', () => ({ ok: false, reason: 'unavailable' }));
  backend.reply('call:availability', (a) => (a?.available === false ? { ok: false, reason: 'unavailable' } : backend.defaults['call:availability'](a)));
  await open(page);
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(banner(page)).toContainText('The server is unavailable: try again in a moment');
  await page.getByRole('switch', { name: 'Available for calls' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your availability did not change' }).first()).toContainText('The server is unavailable: try again in a moment');
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

test('the bar shows the network quality, which a screen reader hears as such, and follows the link as it changes', async ({ page, backend }) => {
  await open(page);
  // The link's stats as the browser reports them, steered by the test: the round trip and loss the server reports
  // about the agent's voice, and the caller's packets arriving.
  await page.evaluate(() => {
    const w = window as any;
    w.__link = { rtt: 0.08, received: 0 };
    RTCPeerConnection.prototype.getStats = async () => {
      w.__link.received += 100;
      return new Map([
        ['out', { type: 'remote-inbound-rtp', roundTripTime: w.__link.rtt, fractionLost: 0, jitter: 0.005 }],
        ['in', { type: 'inbound-rtp', kind: 'audio', jitter: 0.005, packetsLost: 0, packetsReceived: w.__link.received }],
      ]) as unknown as RTCStatsReport;
    };
  });
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(bar(page)).toContainText('Network quality: Good');
  await page.evaluate(() => ((window as any).__link.rtt = 0.8)); // the round trip grows to 800 ms
  await expect(bar(page)).toContainText('Network quality: Poor');
  await expect(bar(page).getByText('Network quality:')).toHaveClass(/sr-only/); // the icon and the word say it on screen
});

test('a caller the browser would not play until a click (a tab reloaded mid-call) is heard with Hear the caller, and the focus stays on the call', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      return (window as any).__clicked ? play.call(this) : Promise.reject(new DOMException('play() needs a click first', 'NotAllowedError'));
    };
  });
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const hear = bar(page).getByRole('button', { name: 'Hear the caller' });
  await hear.focus();
  await page.evaluate(() => ((window as any).__clicked = true));
  await page.keyboard.press('Enter');
  await expect(hear).toHaveCount(0);
  expect(await page.evaluate(() => (document.querySelector('audio[hidden]') as HTMLAudioElement).paused)).toBe(false);
  await expect(bar(page)).toBeFocused();
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
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'agent-producer-2' });
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

test('on an active call the call time starts the details line, under the caller’s name; the status stays there for a screen reader', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const time = bar(page).getByRole('timer', { name: 'Call time' });
  await expect(time).toBeVisible();
  const left = (l: Locator) => l.evaluate((el) => Math.round(el.getBoundingClientRect().left));
  expect(await left(time)).toBe(await left(bar(page).getByText('Pak Joko')));
  const status = bar(page).getByRole('status');
  await expect(status).toHaveText('');
  await bar(page).getByRole('button', { name: 'Hang up' }).click();
  await expect(status).toHaveText(/^(Hanging up…|You hung up)$/);
});

test('the microphone picker shows a long name from its left edge, on one line cut where the room ends', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = await gum({ audio: true });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: 'mic-a' });
      return stream;
    };
    const device = (deviceId: string, label: string) => ({ deviceId, kind: 'audioinput', label, groupId: deviceId, toJSON() { return this; } });
    navigator.mediaDevices.enumerateDevices = async () => [device('mic-a', 'MacBook Pro Microphone (Built-in)'), device('mic-b', 'Headset')] as MediaDeviceInfo[];
  });
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const picker = bar(page).getByRole('combobox', { name: 'Microphone' });
  await expect(picker).toHaveText('MacBook Pro Microphone (Built-in)');
  // The lines the name is laid out on (an ellipsis splits a line in two boxes), and how far its first box starts from
  // where the picker's content does.
  const shown = await picker.evaluate((el) => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const boxes = [...range.getClientRects()];
    const cs = getComputedStyle(el);
    const start = el.getBoundingClientRect().left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    return { lines: new Set(boxes.map((b) => Math.round(b.top))).size, indent: Math.round(boxes[0].left - start) };
  });
  expect(shown).toEqual({ lines: 1, indent: 0 });
});

/**
 * Microphones the test unplugs and plugs back in: `__unplug(id)` takes one off the list and ends the track opened on it,
 * as the browser does; `__plugIn(id)` lists it again. Chrome's fake device stands in for each: a microphone asked for by
 * its id opens if it is listed (an `ideal` one that is not gives way to the first listed, the browser's default), and
 * none listed is none found.
 */
function pluggable(mics: Array<[id: string, label: string]>) {
  if (window.origin === 'null') return; // the blank page axe finishes its run in
  const w = window as any;
  const labels = new Map(mics);
  let listed = mics.map(([id]) => id);
  const opened: Array<[string, MediaStreamTrack]> = [];
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () =>
    listed.map((deviceId) => ({ deviceId, kind: 'audioinput', label: labels.get(deviceId), groupId: deviceId, toJSON() { return this; } })) as MediaDeviceInfo[];
  navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
    const asked = ((c?.audio as MediaTrackConstraints | undefined)?.deviceId ?? {}) as ConstrainDOMStringParameters;
    const id = [asked.exact, asked.ideal].find((x) => listed.includes(x as string)) as string | undefined ?? (asked.exact ? undefined : listed[0]);
    if (!id) throw new DOMException('Requested device not found', 'NotFoundError');
    const track = (await gum({ audio: true })).getAudioTracks()[0];
    const settings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...settings(), deviceId: id });
    Object.defineProperty(track, 'label', { value: labels.get(id) });
    opened.push([id, track]);
    return new MediaStream([track]);
  };
  w.__unplug = (id: string) => {
    listed = listed.filter((x) => x !== id);
    for (const [at, track] of opened) {
      if (at !== id || track.readyState === 'ended') continue;
      track.stop();
      track.dispatchEvent(new Event('ended'));
    }
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  };
  w.__plugIn = (id: string) => {
    listed.push(id);
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  };
}
/** The microphone the call sends, and whether it is live. */
const sending = (page: Page) =>
  page.evaluate(() => {
    const track = (window as any).__pcs.flatMap((pc: RTCPeerConnection) => pc.getSenders()).find((s: RTCRtpSender) => s.track)?.track as MediaStreamTrack | undefined;
    return track && { label: track.label, state: track.readyState };
  });

test('a microphone unplugged mid-call gives way to another by itself, the choice stored stays, and the one unplugged can be chosen again once it is back', async ({ page, context, backend }) => {
  await context.addInitScript(pluggable, [['mic-a', 'Desk microphone'], ['mic-b', 'Headset']]);
  await open(page);
  await page.evaluate(() => localStorage.setItem('multiwa:calls:u-ada:mic', 'mic-b'));
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const picker = bar(page).getByRole('combobox', { name: 'Microphone' });
  await expect(picker).toHaveText('Headset');
  await expect.poll(() => sending(page)).toEqual({ label: 'Headset', state: 'live' });
  await page.evaluate(() => (window as any).__unplug('mic-b'));
  await expect(bar(page).getByRole('alert')).toHaveText('The microphone stopped: the call now uses Desk microphone');
  await expect.poll(() => sending(page)).toEqual({ label: 'Desk microphone', state: 'live' });
  await expect(picker).toHaveText('Desk microphone');
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:mic'))).toBe('mic-b');
  await page.evaluate(() => (window as any).__plugIn('mic-b'));
  await picker.click();
  await page.getByRole('option', { name: 'Headset' }).click();
  await expect.poll(() => sending(page)).toEqual({ label: 'Headset', state: 'live' });
  await expect(picker).toHaveText('Headset');
  await expect(bar(page).getByRole('alert')).toHaveCount(0);
});

test('the only microphone unplugged mid-call says why the caller hears nothing, and comes back by itself once one is plugged in', async ({ page, context, backend }) => {
  await context.addInitScript(pluggable, [['mic-a', 'Desk microphone']]);
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  const picker = bar(page).getByRole('combobox', { name: 'Microphone' });
  await expect(picker).toHaveText('Desk microphone'); // one microphone: it can be chosen again
  await page.evaluate(() => (window as any).__unplug('mic-a'));
  await expect(bar(page).getByRole('alert')).toHaveText('No microphone found: plug one in and try again');
  await expect.poll(() => sending(page)).toEqual({ label: 'Desk microphone', state: 'ended' });
  await page.evaluate(() => (window as any).__plugIn('mic-a'));
  await expect(bar(page).getByRole('alert')).toHaveText('The microphone stopped: the call now uses Desk microphone');
  await expect.poll(() => sending(page)).toEqual({ label: 'Desk microphone', state: 'live' });
  await expect(picker).toHaveText('Desk microphone');
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
  await settled(banner(page));
  await expectAccessible(page, '[aria-label="Incoming calls"]'); // as it fades too
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
  // Once the focus moved on, a click beside every control (on the page's heading) focuses nothing again: the page.
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
  await rendered(page); // the console's effects have run
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
  // The answer's audio is built over the same socket, after any second answer: once its voice is produced, that one
  // would have come.
  await expect.poll(() => produced(backend)).toBe(1);
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

test('a header menu left open behind another tab closes once the agent is back to a call that rang there: its Answer shows', async ({ page, backend }) => {
  await open(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  const back = await behindAnotherTab(page);
  backend.emit('call:ringing', ringing());
  const answerButton = banner(page).getByRole('button', { name: 'Answer' });
  await expect.poll(() => holds(answerButton)).toBe(true);
  await back();
  await expect(menu).toHaveCount(0);
  await expect(answerButton).toBeFocused();
  // Nothing covers it: Enter answers a call the agent sees.
  const reached = await answerButton.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });
  expect(reached).toBe(true);
});

test('a call a reload rejoined behind another tab gives the focus to the main content once its bar goes, not to the page', async ({ page, backend }) => {
  await open(page);
  await answer(page, backend);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  page.on('dialog', (d) => void d.accept()); // the leave-page warning
  backend.offline = true; // the reload's socket waits, so the rejoin comes once the page is behind the other tab
  await page.reload();
  const back = await behindAnotherTab(page);
  await expect.poll(() => holds(bar(page))).toBe(true); // the call stored here, shown at once, as after any reload
  backend.offline = false;
  await expect.poll(() => backend.commands('call:rejoin'), { timeout: 15_000 }).toHaveLength(1);
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

// The header during a call, at the widths agents work at: two microphones (so the bar shows its picker) and the
// recording notice playing, the bar's widest moment.
const twoMics = () => {
  if (window.origin === 'null') return; // the blank page axe finishes its run in: it has no microphones
  const device = (deviceId: string, label: string) => ({ deviceId, kind: 'audioinput', label, groupId: deviceId, toJSON() { return this; } });
  navigator.mediaDevices.enumerateDevices = async () => [device('mic-a', 'Desk microphone'), device('mic-b', 'Headset')] as MediaDeviceInfo[];
};
/** Whether each of the bar's controls shows whole, in the header, and is what a click at its centre reaches. */
const reachable = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Current call"] :is(button, [role="combobox"])')].map((el) => {
      const r = el.getBoundingClientRect();
      const header = el.closest('header')!.getBoundingClientRect();
      const whole = r.left >= Math.max(0, header.left) && r.right <= Math.min(innerWidth, header.right) && r.top >= header.top && r.bottom <= header.bottom;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return [el.getAttribute('aria-label') ?? el.textContent, whole && !!hit && el.contains(hit)];
    }),
  );
/** The header's other controls the bar covers or touches. */
const overlapped = (page: Page) =>
  page.evaluate(() => {
    const barBox = document.querySelector('[aria-label="Current call"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('header :is([aria-label$="menu"], [aria-label="Calls availability"], [aria-label^="Notifications"])')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < barBox.right && barBox.left < r.right && r.top < barBox.bottom && barBox.top < r.bottom;
      })
      .map((el) => el.getAttribute('aria-label'));
  });
for (const [width, height, sidebars] of [
  [1280, 800, ['open', 'collapsed']],
  [1024, 768, ['open', 'collapsed']],
  [768, 1024, ['open', 'collapsed']],
  [360, 740, ['a drawer']],
] as const) {
  for (const sidebar of sidebars) {
    test(`${width} px wide, the sidebar ${sidebar}: every control of the bar shows whole and takes its own click, clear of the rest of the header`, async ({ page, context, backend }) => {
      await page.setViewportSize({ width, height });
      await context.addInitScript(twoMics);
      await open(page);
      if (sidebar === 'collapsed') {
        await page.getByRole('button', { name: 'Close menu' }).click();
        await expect(page.getByRole('main')).toHaveCSS('margin-left', '80px');
      }
      await answer(page, backend, { recorded: true });
      backend.emit('call:announcing', { callId: 'call-1', durationSec: 60 });
      await expect(bar(page)).toContainText('The caller hears the recording notice');
      await expect(bar(page).getByRole('combobox', { name: 'Microphone' })).toBeVisible();
      expect(await reachable(page)).toEqual([['Mute', true], ['Microphone', true], ['Hang up', true]]);
      expect(await overlapped(page)).toEqual([]);
      if (width === 360) await expectAccessible(page, 'header');
      // A call that rang before this one was answered keeps its banner: it floats below the header, clear of the bar.
      backend.emit('call:ringing', ringing(SARI));
      await expect(card(page, 'Bu Sari')).toBeVisible();
      expect(await reachable(page)).toEqual([['Mute', true], ['Microphone', true], ['Hang up', true]]);
    });
  }
}

// A caller and a profile with long names: the name line is cut, not the controls.
const LONG_NAMES = { caller: { name: 'Pak Joko Widodo Santoso Hadiningrat', number: '628111000111' }, profileName: 'Customer Service Line 1' };
for (const [width, height] of [[360, 740], [390, 844], [1440, 900]] as const) {
  test(`${width} px wide, long names: the name line is cut, and every control of the bar shows whole and takes its own click`, async ({ page, context, backend }) => {
    await page.setViewportSize({ width, height });
    await context.addInitScript(twoMics);
    await open(page);
    await answer(page, backend, { recorded: true, ...LONG_NAMES });
    backend.emit('call:announcing', { callId: 'call-1', durationSec: 60 });
    await expect(bar(page)).toContainText('The caller hears the recording notice');
    await expect(bar(page).getByRole('combobox', { name: 'Microphone' })).toBeVisible();
    expect(await reachable(page)).toEqual([['Mute', true], ['Microphone', true], ['Hang up', true]]);
    expect(await overlapped(page)).toEqual([]);
    const name = bar(page).getByText('Pak Joko Widodo Santoso Hadiningrat');
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
}

// Where the bar sits between the header's controls (the header 68rem wide or more), it is one line within the
// header's own height: a call does not make the header taller there.
for (const [width, height, sidebar] of [[1440, 900, 'open'], [1216, 800, 'collapsed'], [1920, 1080, 'open']] as const) {
  test(`${width} px wide, the sidebar ${sidebar}: the bar sits inline, and the header keeps its height through the call`, async ({ page, context, backend }) => {
    await page.setViewportSize({ width, height });
    await context.addInitScript(twoMics);
    await open(page);
    if (sidebar === 'collapsed') {
      await page.getByRole('button', { name: 'Close menu' }).click();
      await expect(page.getByRole('main')).toHaveCSS('margin-left', '80px');
    }
    const header = page.locator('header');
    const tall = () => header.evaluate((el: HTMLElement) => el.offsetHeight);
    const before = await tall();
    await answer(page, backend, { recorded: true, ...LONG_NAMES });
    backend.emit('call:announcing', { callId: 'call-1', durationSec: 600 });
    await expect(bar(page)).toContainText('The caller hears the recording notice');
    await expect(bar(page).getByRole('combobox', { name: 'Microphone' })).toBeVisible();
    // Inline: in the row of the header's menu button.
    expect(await bar(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const menu = el.closest('header')!.querySelector('button')!.getBoundingClientRect();
      return r.top < menu.bottom && menu.top < r.bottom;
    })).toBe(true);
    expect(await tall()).toBe(before);
    expect(await reachable(page)).toEqual([['Mute', true], ['Microphone', true], ['Hang up', true]]);
    backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 3_600_000).toISOString() });
    await expect(bar(page).getByRole('timer', { name: 'Call time' })).toHaveText(/^1:00:0\d$/);
    expect(await tall()).toBe(before);
  });
}

// Pages sized to the screen below the header: a call's bar makes the header taller, and they shrink with it.
const CONV = { id: 'conv-1', profileId: PROFILE.id, jid: '628111000111@s.whatsapp.net', contactId: 'ct-1', name: 'Pak Joko', type: 'user', unreadCount: 0 };
/** Whether the element shows whole on the screen. */
const onScreen = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  });
async function onAnnouncedCall(page: Page, backend: FakeBackend) {
  await answer(page, backend, { recorded: true });
  backend.emit('call:announcing', { callId: 'call-1', durationSec: 60 });
  await expect(bar(page)).toContainText('The caller hears the recording notice');
  await expect(bar(page).getByRole('combobox', { name: 'Microphone' })).toBeVisible();
}
for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`${width} px wide, during a call: the chat the banner links to keeps its message field and Send on the screen`, async ({ page, context, backend }) => {
    await page.setViewportSize({ width, height });
    await context.addInitScript(twoMics);
    backend.route(get('/conversations', { conversations: [CONV], total: 1 }));
    backend.route(get('/messages/conversation/conv-1', { messages: [], hasMore: false }));
    await page.goto('/dashboard/chat?profile=p-1&conv=conv-1');
    await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
    const composer = [page.getByPlaceholder('Type a message'), page.getByRole('button', { name: 'Send message' })];
    await expect(composer[0]).toBeVisible();
    expect(await Promise.all(composer.map(onScreen))).toEqual([true, true]);
    await onAnnouncedCall(page, backend);
    await expect.poll(() => Promise.all(composer.map(onScreen))).toEqual([true, true]);
  });
}

test('1280 px wide, with or without a call: the flow builder’s canvas ends on the screen', async ({ page, context, backend }) => {
  await context.addInitScript(twoMics);
  await page.goto('/dashboard/automation/builder');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  const canvas = page.locator('.react-flow');
  await expect(canvas).toBeVisible();
  const ends = () => canvas.evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight);
  expect(await ends()).toBe(true);
  await onAnnouncedCall(page, backend);
  await expect.poll(ends).toBe(true);
});

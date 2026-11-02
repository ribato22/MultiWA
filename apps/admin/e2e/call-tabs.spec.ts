import { test, expect, get, rendered, requestEnded, ringing, ME, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { holdMics } from './support/browser';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const bar = (page: Page) => page.getByRole('group', { name: 'Current call' });
const timer = (page: Page) => bar(page).getByRole('timer', { name: 'Call time' });
const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);
async function open(page: Page, path = '/dashboard/calls') {
  await page.goto(path);
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
}
const produced = (backend: FakeBackend) => backend.commands('call:media').filter((a) => a.op === 'produce').length;
/** The stored calls of this tab (sessionStorage): the call a reload rejoins. */
const storedCalls = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('multiwa:call')));
const senderEnabled = (page: Page) =>
  page.evaluate(() =>
    (window as any).__pcs
      .filter((pc: RTCPeerConnection) => pc.signalingState !== 'closed')
      .flatMap((pc: RTCPeerConnection) => pc.getSenders())
      .filter((s: RTCRtpSender) => s.track)
      .map((s: RTCRtpSender) => s.track!.enabled),
  );
/** The peer connections still open (a closed one's signalingState is `closed`). */
const openPeers = (page: Page) => page.evaluate(() => (window as any).__pcs.filter((pc: RTCPeerConnection) => pc.signalingState !== 'closed').length);
/** The call's transports fail, as when the network goes: mediasoup reads the peer connection's state. */
const failTransports = (page: Page) =>
  page.evaluate(() => {
    for (const pc of (window as any).__pcs as RTCPeerConnection[]) {
      if (pc.signalingState === 'closed') continue;
      Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' });
      pc.dispatchEvent(new Event('connectionstatechange'));
    }
  });
/** The microphone of the call, kept to look at after it went. */
const keepMic = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    w.__mic = w.__pcs.flatMap((pc: RTCPeerConnection) => pc.getSenders()).find((s: RTCRtpSender) => s.track)?.track;
  });
const socketOpen = (page: Page) => page.evaluate(() => (window as any).__socketOpen() as boolean);
/** Answered and active for a minute already: the server said so once the agent's voice was produced, as it does. */
async function onCall(page: Page, backend: FakeBackend) {
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => produced(backend)).toBe(1);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 60_000).toISOString() });
  await expect(timer(page)).toBeVisible();
}

test('a reload during a call rejoins it: new audio, and "Connecting…" until the server says active', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  page.on('dialog', (d) => void d.accept()); // the leave-page warning
  await page.reload();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => backend.commands('call:media').filter((a) => a.op === 'produce').length).toBe(2);
  // The server connects this page's voice, not the one the reload left: this tab knows its own.
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 61_000).toISOString(), agentProducerId: 'agent-producer-2' });
  await expect(timer(page)).toHaveText(/^1:0[1-5]$/);
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
  await expect(bar(page)).not.toContainText('On a call in another tab');
  expect(await openPeers(page)).toBe(2);
});

test('a reload while the network is down shows the call stored here at once, Reconnecting…, its Hang up waiting for the server, and still asks before leaving', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  page.once('dialog', (d) => void d.accept()); // the reload's own leave-page warning
  backend.offline = true;
  await page.reload();
  await expect(bar(page)).toContainText('Reconnecting…');
  await expect(bar(page)).toContainText('Pak Joko');
  const hangUp = bar(page).getByRole('button', { name: 'Hang up' });
  await expect(hangUp).toHaveAttribute('aria-disabled', 'true');
  await expect(hangUp).toHaveAccessibleDescription('Reconnecting…');
  await hangUp.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Calls', exact: true }).click(); // the browser asks before leaving only a page clicked on
  const dialog = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss(); // stay on the page
  backend.offline = false;
  await expect.poll(() => backend.commands('call:rejoin'), { timeout: 15_000 }).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect(hangUp).not.toHaveAttribute('aria-disabled', 'true');
  expect(backend.commands('call:hangup')).toEqual([]);
});

test('a reload after the call ended elsewhere finds nothing to rejoin', async ({ page, backend }) => {
  backend.reply('call:rejoin', () => ({ ok: false, reason: 'not_in_call' }));
  await open(page);
  await onCall(page, backend);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('The call is over');
  expect(await storedCalls(page)).toEqual([]);
});

test('signing out while a reload rejoins the call closes the microphone at once, and rejoins nothing', async ({ page, context, backend }) => {
  await open(page);
  await onCall(page, backend);
  // After the reload, the microphone opens when the test says so, as when the browser asks the agent first.
  await context.addInitScript(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => new Promise((resolve) => (w.__openMic = () => gum(c).then((s) => resolve((w.__mic = s)))));
  });
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('Connecting…');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/); // a client navigation: the console is gone, this page is not
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => page.evaluate(() => (window as any).__mic.getAudioTracks()[0].readyState)).toBe('ended');
  expect(backend.commands('call:rejoin')).toEqual([]);
});

test('leaving the page during a call asks first', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  const dialog = page.waitForEvent('dialog');
  void page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss(); // stay on the page
  expect(page.isClosed()).toBe(false);
});

test('moving between pages keeps the call and its audio, with no reload', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await page.evaluate(() => ((window as any).__sameDocument = true));
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'API Keys' }).click();
  await expect(page).toHaveURL(/\/dashboard\/api-keys$/);
  await expect(timer(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
  expect(backend.commands('call:rejoin')).toEqual([]);
});

test('the profiles page opens a profile without a reload, so a call carries on', async ({ page, backend }) => {
  await open(page, '/dashboard/profiles');
  await onCall(page, backend);
  await page.evaluate(() => ((window as any).__sameDocument = true));
  await page.getByRole('button', { name: 'View Line 1 details' }).click();
  await expect(page).toHaveURL(/\/dashboard\/profiles\/p-1$/);
  expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
  await expect(bar(page)).toBeVisible();
});

test('another tab of the agent shows the call as theirs, and can take its audio over', async ({ page, context, backend }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // to every tab of the agent
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(bar(other)).toContainText('On a call in another tab');
  await expect(banner(other)).toHaveCount(0);
  await bar(other).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1' }]);
  await expect(bar(page)).toContainText('On a call in another tab'); // the first tab let go of its audio
  // Closed already: before the server's call:active, the only word the first tab had is the other tab's.
  await expect.poll(() => page.evaluate(() => (window as any).__pcs.every((pc: RTCPeerConnection) => pc.connectionState === 'closed'))).toBe(true);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(bar(other).getByRole('button', { name: 'Mute' })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
});

test('one tab rings for the agent, and Dismiss in one tab dismisses the call in the others', async ({ page, context, backend }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  backend.emit('call:ringing', ringing());
  await expect(banner(other)).toBeVisible();
  const ringingTabs = async () => (await Promise.all([page, other].map((p) => p.evaluate(() => (window as any).__tones > 0)))).filter(Boolean).length;
  await expect.poll(ringingTabs, { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(3500);
  expect(await ringingTabs()).toBe(1); // the other tab stays quiet through a whole ring cycle
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(other)).toHaveCount(0);
});

test('a call another tab had, whose end this tab missed while its socket was down, is read again on reconnect, and the next call rings here', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  await expect(bar(page)).toContainText('On a call in another tab'); // and the ringer goes quiet
  backend.route(get('/calls/call-1', { id: 'call-1', outcome: 'answered', endedAt: new Date().toISOString() }));
  await page.evaluate(() => localStorage.setItem('accessToken', 'refreshed-token')); // so the socket connects again
  backend.dropSockets();
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'agent', endReason: 'hangup', talkSeconds: 30 }); // to no socket
  await expect(bar(page)).toContainText('Call ended');
  const before = await tones(page);
  backend.emit('call:ringing', ringing({ callId: 'call-2' }));
  await expect(banner(page)).toBeVisible();
  await expect.poll(() => tones(page), { timeout: 2000 }).toBeGreaterThan(before);
});

/** The server's read of a call another tab of the agent still connects: it rings, and names nobody (it hides a claim). */
const STILL_CONNECTING = { id: 'call-1', outcome: 'ringing', endedAt: null, answeredByUserId: null, answeredBy: null };

test('a socket that drops while another tab of the agent connects the call keeps the call as theirs, and hears it go through', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing({ recorded: true }));
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  await expect(bar(page)).toContainText('On a call in another tab');
  backend.route(get('/calls/call-1', STILL_CONNECTING));
  const read = requestEnded(page, '/calls/call-1');
  backend.blip();
  await read; // read again at the reconnect
  await rendered(page);
  await expect(bar(page)).toContainText('On a call in another tab');
  backend.emit('call:announcing', { callId: 'call-1', durationSec: 6 });
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Calls availability' })).toContainText('On a call');
  // Answered since, by this agent: another drop keeps it too.
  backend.route(get('/calls/call-1', { ...STILL_CONNECTING, outcome: 'answered', answeredByUserId: ME.id, answeredAt: new Date().toISOString() }));
  const again = requestEnded(page, '/calls/call-1');
  backend.blip();
  await again;
  await rendered(page);
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
});

test("a call another tab's answer gave back while this tab's socket was down ends here once the server's time to connect it is over", async ({ page, backend }) => {
  await page.clock.install();
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  await expect(bar(page)).toContainText('On a call in another tab');
  // That answer's audio did not connect meanwhile, and the call rings again: the read is the same as while it connects.
  backend.route(get('/calls/call-1', STILL_CONNECTING));
  const reads = () => backend.requests.filter((r) => r.path === '/calls/call-1').length;
  backend.blip();
  await expect.poll(async () => (await page.clock.runFor(1_000), reads())).toBe(1); // reconnected, and read again
  await page.clock.runFor(10_000);
  await expect(bar(page)).toContainText('On a call in another tab'); // that answer may still connect
  await page.clock.runFor(5_000); // the server's time for it is over
  await expect.poll(reads).toBe(2);
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeVisible(); // no longer on a call
});

test('a socket that drops and comes back while a reload waits for the microphone rejoins once, and the end of the call closes all of it', async ({ page, context, backend }) => {
  await open(page);
  await onCall(page, backend);
  await holdMics(context);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  const reads = backend.commands('call:availability').length;
  backend.blip();
  await expect.poll(() => backend.commands('call:availability').length, { timeout: 10_000 }).toBeGreaterThan(reads); // connected again
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => produced(backend)).toBeGreaterThanOrEqual(2); // the first page's, then this page's
  expect(backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 70 });
  await expect(bar(page)).toContainText('The caller hung up');
  await expect
    .poll(() => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState)))
    .toEqual(['ended']);
  await expect.poll(() => openPeers(page)).toBe(0);
});

test('audio that fails while the socket is down lets the microphone go at once, and comes back with the socket', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  await keepMic(page);
  backend.offline = true; // the network went: the page's socket drops and cannot connect again
  backend.blip();
  await expect.poll(() => socketOpen(page)).toBe(false);
  await failTransports(page);
  await expect.poll(() => page.evaluate(() => (window as any).__mic.readyState)).toBe('ended');
  await expect(bar(page)).toContainText('Reconnecting…');
  expect(await openPeers(page)).toBe(0);
  backend.offline = false; // back within the agent grace: the call goes on, its audio built again
  await expect.poll(() => backend.commands('call:rejoin'), { timeout: 15_000 }).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 70_000).toISOString(), agentProducerId: 'agent-producer-2' });
  await expect(timer(page)).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
  await expect(bar(page)).not.toContainText('Reconnecting…');
  expect(await openPeers(page)).toBe(2);
});

test('a call another device of the agent took during an outage stays there: the rejoin at the reconnect is told it moved, and this tab lets go', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  await keepMic(page);
  backend.offline = true;
  backend.blip();
  await expect.poll(() => socketOpen(page)).toBe(false);
  // The agent took the call on their phone meanwhile: the server closed this tab's peer, and its call:active, naming
  // the phone's producer, reached no socket of this tab.
  await failTransports(page);
  await expect(bar(page)).toContainText('Reconnecting…');
  backend.reply('call:rejoin', (a) =>
    typeof a.ifProducerId === 'string' && a.ifProducerId !== 'producer-phone' ? { ok: false, reason: 'moved' } : backend.defaults['call:rejoin'](a),
  );
  backend.offline = false;
  await expect.poll(() => backend.commands('call:rejoin'), { timeout: 15_000 }).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect(bar(page)).toContainText('On a call in another tab');
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
  await expect(bar(page).getByRole('alert')).toHaveCount(0); // nothing went wrong
  expect(produced(backend)).toBe(1);
  expect(await page.evaluate(() => (window as any).__mic.readyState)).toBe('ended');
  expect(await openPeers(page)).toBe(0);
  expect(await storedCalls(page)).toEqual([]);
  await expectAccessible(page, '[aria-label="Current call"]');
});

test('a reload keeps the mute: the audio rebuilt here is still muted', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await bar(page).getByRole('button', { name: 'Mute' }).click();
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
  await expect.poll(() => senderEnabled(page)).toEqual([false]);
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
});

test('a call whose answer failed here, then answered in another tab, can still be taken here: its audio connects', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect.poll(() => produced(backend)).toBe(1);
  backend.emit('call:ended', { callId: 'call-1', endReason: 'media_failed' }); // the server gave the answer up (its connect timer)
  await expect(bar(page)).toContainText('Could not connect audio');
  backend.emit('call:ringing', ringing()); // so it rings again
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // this agent's other tab answered it
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'producer-other-tab' });
  await expect(bar(page)).toContainText('On a call in another tab');
  await bar(page).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
  await expect.poll(() => openPeers(page)).toBe(2);
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
});

test('signing out during a call forgets it in this tab: the next login here does not rejoin it', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  expect(await storedCalls(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(await storedCalls(page)).toEqual([]);
});

test('a call another tab is still connecting is not offered here until the server put it through', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing({ recorded: true }));
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  await expect(bar(page)).toContainText('On a call in another tab');
  await expect(bar(page).getByRole('button', { name: 'Hang up' })).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toHaveCount(0);
  await expectAccessible(page, '[aria-label="Current call"]');
  backend.emit('call:announcing', { callId: 'call-1', durationSec: 6 });
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
});

test("a reload rejoining the call is not put off by the late call:active of its own previous page's voice", async ({ page, context, backend }) => {
  await open(page);
  await onCall(page, backend);
  await holdMics(context);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  // The server connected the previous page's producer just before this page's rejoin reached it (a recorded call whose
  // announcement ended then).
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 61_000).toISOString(), agentProducerId: 'agent-producer-1' });
  await expect(timer(page)).toBeVisible();
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
  await expect(bar(page)).not.toContainText('On a call in another tab');
  expect(await openPeers(page)).toBe(2);
});

test("another tab that took the call while this tab's audio was down for an outage keeps it: this tab forgets the call, and neither the reconnect nor a reload takes it back", async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  backend.offline = true;
  backend.blip();
  await expect.poll(() => socketOpen(page)).toBe(false);
  await failTransports(page);
  await expect(bar(page)).toContainText('Reconnecting…');
  // Another tab of this browser, its socket up, took the call: it tells the agent's other tabs.
  await page.evaluate((userId) => new BroadcastChannel(`multiwa-calls:${userId}`).postMessage({ type: 'media', callId: 'call-1' }), ME.id);
  await expect(bar(page)).toContainText('On a call in another tab');
  expect(await storedCalls(page)).toEqual([]);
  const reads = backend.commands('call:availability').length;
  backend.offline = false;
  await expect.poll(() => backend.commands('call:availability').length, { timeout: 15_000 }).toBeGreaterThan(reads);
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  await expect(bar(page)).toHaveCount(0);
  expect(backend.commands('call:rejoin')).toEqual([]);
});

test('audio that cannot be built again with the socket up leaves the call to take here: the next reconnect takes nothing by itself', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  backend.reply('call:rejoin', () => ({ ok: false, reason: 'error' }));
  await failTransports(page);
  await expect(bar(page)).toContainText('The call’s audio could not be reconnected: try again');
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
  expect(backend.commands('call:rejoin')).toHaveLength(1);
  expect(await storedCalls(page)).toEqual([]);
  const reads = backend.commands('call:availability').length;
  backend.blip();
  await expect.poll(() => backend.commands('call:availability').length, { timeout: 10_000 }).toBeGreaterThan(reads);
  expect(backend.commands('call:rejoin')).toHaveLength(1);
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
});

test('Take the call here is not undone by the late call:active of the tab that had the call, which shows no call time either; a takeover after its reply is', async ({ page, backend }) => {
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  const answeredAt = new Date().toISOString();
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'producer-other-tab' });
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
  let rejoined!: () => void;
  backend.reply('call:rejoin', (a) => new Promise((resolve) => (rejoined = () => resolve(backend.defaults['call:rejoin'](a)))));
  await bar(page).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1' }]);
  // Sent before the server had this tab's rejoin: the other tab's voice, connected late (a recorded call's notice ended).
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'producer-other-tab' });
  rejoined();
  await expect.poll(() => produced(backend)).toBe(1);
  // Not this tab's voice: the call is not on here until its own call:active.
  await expect(bar(page)).toContainText('Connecting…');
  await expect(timer(page)).toHaveCount(0);
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'agent-producer-1' });
  await expect(timer(page)).toBeVisible();
  await expect(bar(page).getByRole('button', { name: 'Mute' })).toBeVisible();
  await expect.poll(() => openPeers(page)).toBe(2);
  // Taken since on the agent's phone: this tab lets go.
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'producer-phone' });
  await expect(bar(page)).toContainText('On a call in another tab');
  await expect.poll(() => openPeers(page)).toBe(0);
});

test('a call taken on another device while Take the call here waits for the microphone stays there: the microphone closes as it opens, and nothing is rejoined', async ({ page, context, backend }) => {
  await holdMics(context);
  await open(page);
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // answered in another tab
  const answeredAt = new Date().toISOString();
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'producer-other-tab' });
  await bar(page).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  // The agent took the call on their phone while the browser asked: no rejoin of this tab's is out, so this is newer.
  backend.emit('call:active', { callId: 'call-1', answeredAt, agentProducerId: 'producer-phone' });
  await expect(bar(page)).toContainText('On a call in another tab');
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState))).toEqual(['ended']);
  expect(backend.commands('call:rejoin')).toEqual([]);
});

test('a reload that finds the call moved to another device shows it as theirs, as the call it is, to take here', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  backend.reply('call:rejoin', (a) => (a.ifProducerId ? { ok: false, reason: 'moved' } : backend.defaults['call:rejoin'](a)));
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect(bar(page)).toContainText('On a call in another tab');
  await expect(timer(page)).toHaveText(/^1:0\d$/); // answered a minute ago
  await expect(bar(page).getByRole('alert')).toHaveCount(0);
  expect(await storedCalls(page)).toEqual([]);
  await bar(page).getByRole('button', { name: 'Take the call here' }).click();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }, { callId: 'call-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
});

test('a microphone that stopped is still said after a reconnect: Reconnecting… shows beside it, not over it', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  // Unplugged: the microphone's track ends, and another one takes its place.
  await page.evaluate(() =>
    (window as any).__pcs
      .flatMap((pc: RTCPeerConnection) => pc.getSenders())
      .find((s: RTCRtpSender) => s.track)
      .track.dispatchEvent(new Event('ended')),
  );
  const stopped = /The microphone stopped: the call now uses /;
  await expect(bar(page)).toContainText(stopped);
  backend.offline = true;
  backend.blip();
  await expect(bar(page)).toContainText('Reconnecting…');
  await expect(bar(page)).toContainText(stopped);
  const reads = backend.commands('call:availability').length;
  backend.offline = false;
  await expect.poll(() => backend.commands('call:availability').length, { timeout: 15_000 }).toBeGreaterThan(reads);
  await expect(bar(page)).not.toContainText('Reconnecting…');
  await expect(bar(page)).toContainText(stopped);
});

test('availability reads that fail on a live socket do not say Reconnecting… during a call', async ({ page, backend }) => {
  backend.reply('call:availability', () => ({ ok: false, reason: 'error' }));
  await page.goto('/dashboard/calls');
  await expect.poll(() => backend.commands('call:availability')).toHaveLength(2); // the read at connect, and its one retry
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toContainText('Connecting…');
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString() });
  await expect(timer(page)).toBeVisible();
  await expect(bar(page)).not.toContainText('Reconnecting…');
});

test('audio that fails while a hang-up is on its way is not built again; a hang-up that then fails builds it again', async ({ page, backend }) => {
  let hungUp!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (hungUp = resolve)));
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  await keepMic(page);
  await bar(page).getByRole('button', { name: 'Hang up' }).click();
  await expect.poll(() => backend.commands('call:hangup')).toHaveLength(1);
  await failTransports(page);
  await expect.poll(() => page.evaluate(() => (window as any).__mic.readyState)).toBe('ended');
  expect(await openPeers(page)).toBe(0);
  await expect(bar(page)).toContainText('Hanging up…');
  expect(backend.commands('call:rejoin')).toEqual([]);
  hungUp({ ok: false, reason: 'error' });
  await expect(bar(page)).toContainText('The hang-up did not go through: try again');
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect.poll(() => produced(backend)).toBe(2);
});

test('Hang up pressed while the socket is down, its audio gone too: the reconnect sends it, and builds no audio meanwhile', async ({ page, backend }) => {
  let hungUp!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (hungUp = resolve)));
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  backend.offline = true;
  backend.blip();
  await expect.poll(() => socketOpen(page)).toBe(false);
  await failTransports(page);
  await expect(bar(page)).toContainText('Reconnecting…');
  await bar(page).getByRole('button', { name: 'Hang up' }).click(); // it waits for the socket
  await expect(bar(page)).toContainText('Hanging up…');
  const reads = backend.commands('call:availability').length;
  backend.offline = false;
  await expect.poll(() => backend.commands('call:availability').length, { timeout: 15_000 }).toBeGreaterThan(reads);
  expect(backend.commands('call:hangup')).toHaveLength(1);
  await expect(bar(page)).toContainText('Hanging up…');
  expect(backend.commands('call:rejoin')).toEqual([]);
  hungUp({ ok: true });
  await expect(bar(page)).toContainText('You hung up');
  expect(backend.commands('call:rejoin')).toEqual([]);
  expect(await storedCalls(page)).toEqual([]);
});

test('a call taken on another device while this tab hangs up, its audio gone, is not built again here when the hang-up fails', async ({ page, backend }) => {
  let hungUp!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (hungUp = resolve)));
  await open(page);
  await onCall(page, backend);
  await expect.poll(() => openPeers(page)).toBe(2);
  await bar(page).getByRole('button', { name: 'Hang up' }).click();
  await expect.poll(() => backend.commands('call:hangup')).toHaveLength(1);
  // The agent took the call on their phone just before: the server closed this tab's peer, and says whose it is now.
  await failTransports(page);
  await expect.poll(() => openPeers(page)).toBe(0);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 60_000).toISOString(), agentProducerId: 'producer-phone' });
  await expect.poll(() => storedCalls(page)).toEqual([]);
  hungUp({ ok: false, reason: 'error' });
  await expect(bar(page)).toContainText('On a call in another tab');
  await expect(bar(page).getByRole('button', { name: 'Take the call here' })).toBeVisible();
  expect(backend.commands('call:rejoin')).toEqual([]);
});

test('Hang up while a reload rejoins the call: the microphone that opens after it is silent', async ({ page, context, backend }) => {
  await open(page);
  await onCall(page, backend);
  await holdMics(context);
  let rejoined!: () => void;
  backend.reply('call:rejoin', (a) => new Promise((resolve) => (rejoined = () => resolve(backend.defaults['call:rejoin'](a)))));
  let hungUp!: (r: unknown) => void;
  backend.reply('call:hangup', () => new Promise((resolve) => (hungUp = resolve)));
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  await bar(page).getByRole('button', { name: 'Hang up' }).click();
  await expect(bar(page)).toContainText('Hanging up…');
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => backend.commands('call:rejoin')).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.enabled))).toEqual([false]);
  rejoined();
  await expect.poll(() => produced(backend)).toBe(2);
  expect(await page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.enabled))).toEqual([false]);
  hungUp({ ok: true });
  await expect(bar(page)).toContainText('You hung up');
  await expect.poll(() => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState))).toEqual(['ended']);
});

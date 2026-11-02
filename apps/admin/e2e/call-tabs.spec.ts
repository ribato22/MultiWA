import { test, expect, get, ringing, ME, type FakeBackend } from './support/fixtures';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const bar = (page: Page) => page.getByRole('group', { name: 'Current call' });
const timer = (page: Page) => bar(page).getByRole('timer', { name: 'Call time' });
const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);
async function open(page: Page, path = '/dashboard/calls') {
  await page.goto(path);
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
}
/** Answered and active for a minute already. */
async function onCall(page: Page, backend: FakeBackend) {
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toBeVisible();
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 60_000).toISOString() });
  await expect(timer(page)).toBeVisible();
}

test('a reload during a call rejoins it: new audio, and "Connecting…" until the server says active', async ({ page, backend }) => {
  await open(page);
  await onCall(page, backend);
  page.on('dialog', (d) => void d.accept()); // the leave-page warning
  await page.reload();
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1' }]);
  await expect(bar(page)).toContainText('Connecting…');
  await expect.poll(() => backend.commands('call:media').filter((a) => a.op === 'produce').length).toBe(2);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date(Date.now() - 61_000).toISOString() });
  await expect(timer(page)).toHaveText(/^1:0[1-5]$/);
});

test('a reload after the call ended elsewhere finds nothing to rejoin', async ({ page, backend }) => {
  backend.reply('call:rejoin', () => ({ ok: false, reason: 'not_in_call' }));
  await open(page);
  await onCall(page, backend);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(bar(page)).toContainText('The call is over');
  expect(await page.evaluate(() => sessionStorage.getItem('multiwa:call'))).toBeNull();
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
  await page.getByRole('menuitem', { name: 'Sign out' }).press('Enter');
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

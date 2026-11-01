import { test, expect, ringing } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);
/** The desktop alerts shown so far, as [call, closed]. */
const alerts = (page: Page) => page.evaluate(() => (window as any).__notifications.map((n: any) => [n.options.tag, n.closed]));
const SARI = { callId: 'call-2', caller: { name: 'Bu Sari', number: '628111000222' } };

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled(); // the console is connected
});

test('a ringing call shows on any page: who, on which line, the chat link, and that it is recorded', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing({ recorded: true }));
  const card = banner(page).getByRole('group', { name: 'Call from Pak Joko' });
  await expect(card).toContainText('Line 1');
  await expect(card).toContainText('+628111000111');
  await expect(card).toContainText('This call is recorded');
  await expect(card.getByRole('link', { name: 'Open the chat with Pak Joko' })).toHaveAttribute('href', '/dashboard/chat?profile=p-1&conv=conv-1');
  await expect(page.locator('#calls-announcer')).toHaveText('Incoming call from Pak Joko on Line 1. This call is recorded');
  await expectAccessible(page, '[aria-label="Incoming calls"]');
});

test('it rings and flashes the title; Dismiss stops both, and a re-ring of that call stays dismissed', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  await expect.poll(() => tones(page), { timeout: 8000 }).toBeGreaterThan(0); // the first ring, or the next one 3 s later
  await expect.poll(() => page.title()).toBe('📞 Incoming call');
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page)).toHaveCount(0);
  const after = await tones(page);
  await page.waitForTimeout(3500); // a ring cycle
  expect(await tones(page)).toBe(after);
  expect(await page.title()).not.toBe('📞 Incoming call');
  backend.emit('call:ringing', ringing()); // it rings again (an answer elsewhere failed): still dismissed here
  await page.waitForTimeout(500);
  await expect(banner(page)).toHaveCount(0);
});

test('a hidden tab gets a desktop alert; another agent answering closes it, and the banner says who, then fades', async ({ page, backend }) => {
  await page.evaluate(() => (window as any).__setHidden(true));
  backend.emit('call:ringing', ringing());
  await expect.poll(() => page.evaluate(() => (window as any).__notifications.map((n: any) => [n.title, n.options.body, n.closed]))).toEqual([
    ['Incoming call', 'Pak Joko on Line 1', false],
  ]);
  backend.emit('call:claimed', { callId: 'call-1', byUserId: 'u-jane', byUserName: 'Jane' });
  await expect(banner(page)).toContainText('Answered by Jane');
  await expect.poll(() => page.evaluate(() => (window as any).__notifications[0].closed)).toBe(true);
  await expect(banner(page)).toHaveCount(0, { timeout: 6000 });
});

test('a call that cannot be answered here says why', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing({ answerable: false, unavailableReason: 'web_calling_disabled' }));
  await expect(banner(page)).toContainText('Answer on the phone');
  await expect(banner(page)).toContainText('WhatsApp has not enabled calling on WhatsApp Web for this number');
});

test('a muted ringer stays silent, and a call that stopped ringing closes its banner', async ({ page, backend }) => {
  await page.evaluate(() => localStorage.setItem('multiwa:calls:u-ada:ringer', 'off'));
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await tones(page)).toBe(0);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page)).toHaveCount(0);
});

test('Escape in a ringing card dismisses that call', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Dismiss' }).focus();
  await page.keyboard.press('Escape');
  await expect(banner(page)).toHaveCount(0);
});

test('a second call keeps the ringtone going, and so does the end of the first', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  await expect.poll(() => tones(page), { timeout: 8000 }).toBeGreaterThan(0);
  backend.emit('call:ringing', ringing(SARI));
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  let before = await tones(page);
  await page.waitForTimeout(3500); // a ring cycle
  expect(await tones(page)).toBeGreaterThan(before);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page).getByRole('group')).toHaveCount(1);
  before = await tones(page);
  await page.waitForTimeout(3500);
  expect(await tones(page)).toBeGreaterThan(before);
});

test('each call has its own desktop alert, closed when that call stops ringing', async ({ page, backend }) => {
  await page.evaluate(() => (window as any).__setHidden(true));
  backend.emit('call:ringing', ringing());
  await expect.poll(() => alerts(page)).toEqual([['call-1', false]]);
  backend.emit('call:ringing', ringing(SARI));
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  await expect.poll(() => alerts(page)).toEqual([['call-1', false], ['call-2', false]]);
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner(page).getByRole('group')).toHaveCount(1);
  await expect.poll(() => alerts(page)).toEqual([['call-1', true], ['call-2', false]]);
});

test('the live region says every call that rings, a repeat too, and what became of it, but not a Dismiss', async ({ page, backend }) => {
  const announcer = page.locator('#calls-announcer');
  // A screen reader says a live region's new node: the same words again must come in a new one.
  const mark = () => page.evaluate(() => ((document.querySelector('#calls-announcer')!.firstChild as any).__said = true));
  const marked = () => page.evaluate(() => !!(document.querySelector('#calls-announcer')!.firstChild as any)?.__said);
  backend.emit('call:ringing', ringing());
  await expect(announcer).toHaveText('Incoming call from Pak Joko on Line 1');
  await mark();
  backend.emit('call:ringing', ringing({ callId: 'call-2' })); // the same caller, on the same line
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  await expect.poll(marked).toBe(false);
  await expect(announcer).toHaveText('Incoming call from Pak Joko on Line 1');
  backend.emit('call:claimed', { callId: 'call-1', byUserId: 'u-jane', byUserName: 'Jane' });
  await expect(announcer).toHaveText('Call from Pak Joko answered by Jane');
  backend.emit('call:ended', { callId: 'call-2', outcome: 'missed' });
  await expect(announcer).toHaveText('Call from Pak Joko ended');
  backend.emit('call:ringing', ringing({ callId: 'call-3' }));
  await expect(announcer).toHaveText('Incoming call from Pak Joko on Line 1');
  await mark();
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await marked()).toBe(true);
  await expect(announcer).toHaveText('Incoming call from Pak Joko on Line 1');
});

test('a browser that cannot show a desktop alert still shows the call', async ({ page, backend }) => {
  await page.evaluate(() => {
    (window as any).__notificationThrows = true;
    (window as any).__setHidden(true);
  });
  backend.emit('call:ringing', ringing());
  const card = banner(page).getByRole('group', { name: 'Call from Pak Joko' });
  await expect(card).toBeVisible();
  await page.waitForTimeout(500); // an error in an effect would have unmounted the page by now
  await expect(card).toBeVisible(); // and the fixture fails the test on an uncaught error
});

test('"Answered by …" fades on time while another call rings', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  backend.emit('call:claimed', { callId: 'call-1', byUserId: 'u-jane', byUserName: 'Jane' });
  const taken = banner(page).getByText('Answered by Jane');
  await expect(taken).toBeVisible();
  const at = Date.now();
  await page.waitForTimeout(2500);
  backend.emit('call:ringing', ringing(SARI));
  await expect(banner(page).getByRole('group', { name: 'Call from Bu Sari' })).toBeVisible();
  await expect(taken).toHaveCount(0, { timeout: 8000 });
  expect(Date.now() - at).toBeLessThan(5200); // its own 4 s, not 4 s from the other call's ring
});

test('two tabs of the browser: one of them rings', async ({ page, context, backend }) => {
  const other = await context.newPage();
  await other.goto('/dashboard/calls');
  await expect(other.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await expect(banner(other)).toBeVisible();
  await page.waitForTimeout(3500); // a ring cycle
  expect([await tones(page), await tones(other)].filter((n) => n > 0)).toHaveLength(1);
});

test.describe('on a phone screen', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the banner fits the screen, and the header switch keeps its name', async ({ page, backend }) => {
    backend.emit('call:ringing', ringing());
    await expect(banner(page)).toBeVisible();
    const box = (await banner(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeVisible();
  });
});

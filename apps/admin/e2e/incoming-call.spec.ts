import { test, expect, ringing, ME } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);
/** The desktop alerts shown so far, as [call, closed]. */
const alerts = (page: Page) => page.evaluate(() => (window as any).__notifications.map((n: any) => [n.options.tag, n.closed]));
const SARI = { callId: 'call-2', caller: { name: 'Bu Sari', number: '628111000222' } };
const HINT = 'Click anywhere on the page to hear the ringtone';
/** The tab's titles over a ring cycle (3.5 s), every 200 ms. */
const titles = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        const timer = setInterval(() => seen.push(document.title), 200);
        setTimeout(() => {
          clearInterval(timer);
          resolve(seen);
        }, 3500);
      }),
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled(); // the console is connected
});

test('a ringing call shows on any page: who, on which line, the chat link, and that it is recorded', async ({ page, backend }) => {
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'API Keys' }).click();
  await expect(page).toHaveURL(/\/dashboard\/api-keys$/);
  backend.emit('call:ringing', ringing({ recorded: true }));
  const card = banner(page).getByRole('group', { name: 'Call from Pak Joko' });
  await expect(card).toContainText('Line 1');
  await expect(card).toContainText('+628111000111');
  await expect(card).toContainText('This call is recorded');
  await expect(card.getByRole('link', { name: 'Open the chat with Pak Joko' })).toHaveAttribute('href', '/dashboard/chat?profile=p-1&conv=conv-1');
  await expect(card.getByRole('button', { name: 'Answer' })).toBeEnabled();
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

test('a click on a desktop alert brings the tab forward and closes the alert', async ({ page, backend }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.__setHidden(true);
    w.focus = () => (w.__broughtForward = true);
  });
  backend.emit('call:ringing', ringing());
  await expect.poll(() => alerts(page)).toEqual([['call-1', false]]);
  await page.evaluate(() => (window as any).__notifications[0].onclick());
  expect(await page.evaluate(() => (window as any).__broughtForward)).toBe(true);
  expect(await alerts(page)).toEqual([['call-1', true]]);
});

test('on plain HTTP a call still rings, and its banner says to answer it on the phone', async ({ page, context, backend }) => {
  await context.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toContainText('Answer on the phone');
  await expect(banner(page)).toContainText('Calls in the dashboard need HTTPS');
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeDisabled();
  await expect(banner(page).getByRole('button', { name: 'Dismiss' })).toBeEnabled();
});

test('a browser the media library cannot drive is told so before any answer: the banner says which browsers can', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => 'Mozilla/5.0 (X11) SomeBrowser/1.0' });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  });
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toContainText('This browser cannot answer calls: use a current Chrome, Edge, Firefox or Safari');
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeDisabled();
  expect(backend.commands('call:answer')).toEqual([]);
});

test('a call that cannot be answered here says why', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing({ answerable: false, unavailableReason: 'web_calling_disabled' }));
  await expect(banner(page)).toContainText('Answer on the phone');
  await expect(banner(page)).toContainText('WhatsApp has not enabled calling on WhatsApp Web for this number');
  await expect(banner(page).getByRole('button', { name: 'Answer' })).toBeDisabled();
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
  await expect.poll(() => taken.count(), { timeout: 8000, intervals: [100] }).toBe(0);
  expect(Date.now() - at).toBeLessThan(6000); // its own 4 s, not 4 s from the other call's ring (about 6.5 s)
});

test('no ringtone or title flash while this agent is on a call, here or in another tab; the call still ringing keeps its banner', async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  backend.emit('call:ringing', ringing(SARI));
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  await expect.poll(() => tones(page), { timeout: 8000 }).toBeGreaterThan(0);
  // The server checks an agent only when a call starts to ring: Bu Sari's call rang before this agent took the first.
  backend.emit('call:claimed', { callId: 'call-1', byUserId: ME.id, byUserName: ME.name }); // in another tab
  await expect(banner(page).getByRole('group')).toHaveCount(1);
  await expect(banner(page).getByRole('group', { name: 'Call from Bu Sari' })).toBeVisible();
  const before = await tones(page);
  expect(await titles(page)).not.toContain('📞 Incoming call'); // a ring cycle
  expect(await tones(page)).toBe(before);
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'agent', endReason: 'hangup', talkSeconds: 30 });
  await expect.poll(() => tones(page), { timeout: 1000 }).toBeGreaterThan(before); // it rings again at once
});

test('no ringtone or title flash while this agent answers one of two calls, however long the microphone takes to open', async ({ page, backend }) => {
  // The microphone opens when the test says so, as when the browser asks the agent first.
  await page.evaluate(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => new Promise((resolve, reject) => (w.__openMic = () => gum(c).then(resolve, reject)));
  });
  backend.emit('call:ringing', ringing());
  backend.emit('call:ringing', ringing(SARI));
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  await expect.poll(() => tones(page), { timeout: 8000 }).toBeGreaterThan(0);
  await banner(page).getByRole('group', { name: 'Call from Pak Joko' }).getByRole('button', { name: 'Answer' }).click();
  await expect(banner(page).getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  const before = await tones(page);
  expect(await titles(page)).not.toContain('📞 Incoming call'); // a ring cycle, Bu Sari's call still ringing
  expect(await tones(page)).toBe(before);
  expect(backend.commands('call:answer')).toEqual([]); // the microphone is still opening
  await page.evaluate(() => (window as any).__openMic());
  await expect.poll(() => backend.commands('call:answer')).toEqual([{ callId: 'call-1' }]);
});

test('a tab the browser keeps silent says so and makes no tone; a click on the page lets it ring at once; Dismiss never moves', async ({ page, backend }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.__audioBlocked = true;
    // Where Dismiss is at every change of the page: the hint showing or going must not move it under a press.
    w.__dismissAt = [];
    new MutationObserver(() => {
      const dismiss = [...document.querySelectorAll('[aria-label="Incoming calls"] button')].find((b) => b.textContent?.includes('Dismiss'));
      if (dismiss) w.__dismissAt.push(JSON.stringify(dismiss.getBoundingClientRect()));
    }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByText(HINT)).toBeVisible();
  await page.waitForTimeout(3500); // a ring cycle
  expect(await tones(page)).toBe(0);
  await page.getByRole('heading', { name: 'Calls', exact: true }).click(); // nothing the click does
  await expect(banner(page).getByText(HINT)).toBeHidden();
  await expect.poll(() => tones(page), { timeout: 1000 }).toBeGreaterThan(0); // not at the next 3 s tick
  const at: string[] = await page.evaluate(() => (window as any).__dismissAt);
  expect(at.length).toBeGreaterThan(0);
  expect([...new Set(at)]).toEqual([at[0]]);
});

test('in a tab the browser keeps silent, the first press on Dismiss dismisses, and no tone plays', async ({ page, backend }) => {
  await page.evaluate(() => ((window as any).__audioBlocked = true));
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByText(HINT)).toBeVisible();
  // A press as a hand makes it: the hint must not go, and the button move, between the button going down and up.
  const box = (await banner(page).getByRole('button', { name: 'Dismiss' }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await tones(page)).toBe(0);
});

test('a click on Answer lets a tab the browser keeps silent ring for a later call, even with the ringer off while it rang', async ({ page, backend }) => {
  await page.evaluate(() => {
    (window as any).__audioBlocked = true;
    localStorage.setItem('multiwa:calls:u-ada:ringer', 'off'); // no ringer, so nothing else waits for a click
  });
  const bar = page.getByRole('group', { name: 'Current call' });
  backend.emit('call:ringing', ringing());
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar).toBeVisible();
  backend.emit('call:ended', { callId: 'call-1', endedBy: 'caller', endReason: 'caller_hangup', talkSeconds: 3 });
  await expect(bar).toContainText('The caller hung up');
  await page.evaluate(() => localStorage.setItem('multiwa:calls:u-ada:ringer', 'on'));
  backend.emit('call:ringing', ringing(SARI));
  await expect.poll(() => tones(page), { timeout: 2000 }).toBeGreaterThan(0); // no click since Answer
});

test('a page whose audio runs a moment after it was made (Firefox starts it suspended) rings without showing the hint', async ({ page, backend }) => {
  await page.evaluate(() => {
    const w = window as any;
    w.__audioRunsIn = 50;
    // The hint is always on the card, hidden while the ringtone can play: it must never show.
    new MutationObserver(() => {
      for (const line of document.querySelectorAll('[aria-label="Incoming calls"] p')) {
        if (line.textContent?.includes('Click anywhere on the page to hear the ringtone') && line.checkVisibility({ visibilityProperty: true })) w.__hinted = true;
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  backend.emit('call:ringing', ringing());
  await expect.poll(() => tones(page), { timeout: 2000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => !!(window as any).__hinted)).toBe(false);
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

test('two tabs, the first one kept silent by the browser: the second rings, and the first says why it does not', async ({ page, context, backend }) => {
  await page.evaluate(() => ((window as any).__audioBlocked = true));
  const other = await context.newPage();
  await other.goto('/dashboard/calls');
  await expect(other.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing());
  await expect(banner(page).getByText(HINT)).toBeVisible();
  await expect.poll(() => tones(other), { timeout: 8000 }).toBeGreaterThan(0);
  expect(await tones(page)).toBe(0);
  await expect(banner(other).getByText(HINT)).toBeHidden();
});

test("while a call rings, the header's menus open over the banner: a click reaches Sign out", async ({ page, backend }) => {
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/auth\/login$/);
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

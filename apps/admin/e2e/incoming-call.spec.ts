import { test, expect, ringing } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);

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

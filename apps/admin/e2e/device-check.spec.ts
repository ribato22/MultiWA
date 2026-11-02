import { test, expect, get, ringing, ME } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const section = (page: Page) => page.getByRole('region', { name: 'Calls in this browser' });

test('Settings → Calls checks the microphone with a level meter, plays a test sound, and keeps the ringer choice', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=calls');
  const s = section(page);
  await expect(s).toContainText('Microphone: Allowed');
  await s.getByRole('button', { name: 'Test the microphone' }).click();
  const level = s.getByRole('meter', { name: 'Microphone level' });
  await expect.poll(async () => Number(await level.getAttribute('aria-valuenow')), { timeout: 8000 }).toBeGreaterThan(0); // the fake microphone beeps
  // The fake microphone beeps every 500 ms: a meter that falls back slowly never reads 0 between two beeps.
  const lowest = await level.evaluate(
    (meter) =>
      new Promise<number>((resolve) => {
        let low = 100;
        const start = performance.now();
        const read = () => {
          low = Math.min(low, Number(meter.getAttribute('aria-valuenow')));
          if (performance.now() - start < 1000) requestAnimationFrame(read);
          else resolve(low);
        };
        read();
      }),
  );
  expect(lowest).toBeGreaterThan(0);
  await s.getByRole('button', { name: 'Stop the test' }).click();
  await expect(level).toHaveAttribute('aria-valuenow', '0');
  const tones = await page.evaluate(() => (window as any).__tones as number);
  await s.getByRole('button', { name: 'Play a test sound' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tones)).toBe(tones + 1);
  await s.getByRole('switch', { name: 'Ring for incoming calls' }).click();
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:ringer'))).toBe('off');
  await page.reload();
  await expect(section(page).getByRole('switch', { name: 'Ring for incoming calls' })).toHaveAttribute('aria-checked', 'false');
  await expectAccessible(page, '[aria-label="Calls in this browser"]');
});

test('turning the ringer off silences a call that is ringing', async ({ page, backend }) => {
  const tones = () => page.evaluate(() => (window as any).__tones as number);
  await page.goto('/dashboard/settings?tab=calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled(); // the console is connected
  backend.emit('call:ringing', ringing());
  await expect.poll(tones, { timeout: 8000 }).toBeGreaterThan(0);
  await section(page).getByRole('switch', { name: 'Ring for incoming calls' }).click();
  const after = await tones();
  await page.waitForTimeout(3500); // a ring cycle
  expect(await tones()).toBe(after);
  await expect(page.getByRole('region', { name: 'Incoming calls' })).toBeVisible(); // still ringing, without a sound
});

test('desktop alerts can be turned on from Settings → Calls', async ({ page, context }) => {
  await context.addInitScript(() => {
    (window as any).__notificationPermission = 'default';
  });
  await page.goto('/dashboard/settings?tab=calls');
  await section(page).getByRole('button', { name: 'Turn on desktop alerts' }).click();
  await expect(section(page)).toContainText('Desktop alerts are on');
});

test('the microphone chosen here is the one a call opens', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
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
  await page.goto('/dashboard/settings?tab=calls');
  await section(page).getByRole('combobox', { name: 'Microphone' }).click();
  await page.getByRole('option', { name: 'Headset' }).click();
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:mic'))).toBe('mic-b');
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  backend.emit('call:ringing', ringing());
  await page.getByRole('region', { name: 'Incoming calls' }).getByRole('button', { name: 'Answer' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__asked as string[])).toContainEqual(expect.stringContaining('"ideal":"mic-b"'));
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('has no Calls tab in Settings', async ({ page, backend }) => {
    backend.route(get('/auth/me', { ...ME, role: 'viewer' }));
    await page.goto('/dashboard/settings?tab=calls'); // a link to the tab shows them nothing of it either
    await expect(page.getByRole('tab', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Calls' })).toHaveCount(0);
    await expect(section(page)).toHaveCount(0);
  });
});

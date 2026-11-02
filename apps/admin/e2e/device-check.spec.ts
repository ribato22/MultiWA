import { test, expect, get, ringing, ME, PROFILE } from './support/fixtures';
import { expectAccessible } from './support/axe';
import { holdMics } from './support/browser';
import { RING_INTERVAL_MS } from '@/lib/call-console/attention';
import type { Page } from '@playwright/test';

const section = (page: Page) => page.getByRole('region', { name: 'Calls in this browser' });
/** The microphones this page opened (holdMics), and whether each is still live. */
const micStates = (page: Page) => page.evaluate(() => (window as any).__micTracks.map((t: MediaStreamTrack) => t.readyState) as string[]);
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

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

test('turning the ringer off silences a call that is ringing, and on again rings it; a call that started while it was off stays silent', async ({ page, backend }) => {
  const tones = () => page.evaluate(() => (window as any).__tones as number);
  const banner = page.getByRole('region', { name: 'Incoming calls' });
  await page.goto('/dashboard/settings?tab=calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled(); // the console is connected
  const ringer = section(page).getByRole('switch', { name: 'Ring for incoming calls' });
  backend.emit('call:ringing', ringing());
  await expect.poll(tones, { timeout: 8000 }).toBeGreaterThan(0);
  await ringer.click();
  let after = await tones();
  await page.waitForTimeout(RING_INTERVAL_MS + 500); // a ring cycle
  expect(await tones()).toBe(after);
  await expect(banner).toBeVisible(); // still ringing, without a sound
  await ringer.click();
  await expect.poll(tones, { timeout: RING_INTERVAL_MS + 2000 }).toBeGreaterThan(after); // at its next ring
  backend.emit('call:ended', { callId: 'call-1', outcome: 'missed' });
  await expect(banner).toHaveCount(0);
  await ringer.click();
  backend.emit('call:ringing', ringing({ callId: 'call-2' }));
  await expect(banner).toBeVisible();
  await ringer.click();
  after = await tones();
  await page.waitForTimeout(RING_INTERVAL_MS + 500);
  expect(await tones()).toBe(after);
  await expect(section(page)).toContainText('Off: the banner still shows, without a sound. A call that started ringing while it was off stays silent.');
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

test('a microphone chosen here and since unplugged gives way to one this browser has', async ({ page, context }) => {
  await context.addInitScript(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__asked = [];
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      (window as any).__asked.push(JSON.stringify(c));
      return gum({ audio: true });
    };
    navigator.mediaDevices.enumerateDevices = async () =>
      [{ deviceId: 'mic-a', kind: 'audioinput', label: 'Desk microphone', groupId: 'g1', toJSON() { return this; } }] as MediaDeviceInfo[];
  });
  await page.goto('/dashboard/settings?tab=calls');
  await page.evaluate(() => localStorage.setItem('multiwa:calls:u-ada:mic', 'headset-unplugged'));
  await page.reload();
  const s = section(page);
  await expect(s.getByRole('combobox', { name: 'Microphone' })).toHaveText('Desk microphone');
  await s.getByRole('button', { name: 'Test the microphone' }).click();
  await expect(s.getByRole('button', { name: 'Stop the test' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__asked as string[])).toEqual([JSON.stringify({ audio: { deviceId: { exact: 'mic-a' } } })]);
});

test('a second click while the browser asks for the microphone starts no second test: Stop leaves no microphone open', async ({ page, context }) => {
  await holdMics(context);
  await page.goto('/dashboard/settings?tab=calls');
  const s = section(page);
  await s.getByRole('button', { name: 'Test the microphone' }).dblclick();
  await page.evaluate(() => (window as any).__openMic());
  await s.getByRole('button', { name: 'Stop the test' }).click();
  await expect(s.getByRole('button', { name: 'Test the microphone' })).toBeVisible();
  await expect.poll(() => micStates(page)).toEqual(['ended']);
});

test('a microphone picked while a test opens is kept: the one opened meanwhile closes, and the next test opens the pick', async ({ page, context }) => {
  await context.addInitScript(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__asked = [];
    // The microphone asked for opens by its id: Chrome's fake device stands in for both.
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      (window as any).__asked.push(JSON.stringify(c));
      const stream = await gum({ audio: true });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings.bind(track);
      const id = (((c?.audio as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters).exact as string);
      track.getSettings = () => ({ ...settings(), deviceId: id });
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () =>
      [
        { deviceId: 'mic-a', kind: 'audioinput', label: 'Desk microphone', groupId: 'g1', toJSON() { return this; } },
        { deviceId: 'mic-b', kind: 'audioinput', label: 'Headset', groupId: 'g2', toJSON() { return this; } },
      ] as MediaDeviceInfo[];
  });
  await holdMics(context);
  await page.goto('/dashboard/settings?tab=calls');
  const s = section(page);
  const picker = s.getByRole('combobox', { name: 'Microphone' });
  const asked = () => page.evaluate(() => (window as any).__micsAsked() as number);
  await expect(picker).toHaveText('Desk microphone');
  await s.getByRole('button', { name: 'Test the microphone' }).click();
  await expect.poll(asked).toBe(1);
  await picker.click();
  await page.getByRole('option', { name: 'Headset' }).click();
  await page.evaluate(() => (window as any).__openMic()); // the desk microphone, asked for before the pick
  await expect.poll(() => micStates(page)).toEqual(['ended']);
  await expect(picker).toHaveText('Headset');
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:mic'))).toBe('mic-b');
  await s.getByRole('button', { name: 'Test the microphone' }).click();
  await expect.poll(asked).toBe(1);
  await page.evaluate(() => (window as any).__openMic());
  await expect(s.getByRole('button', { name: 'Stop the test' })).toBeVisible();
  await expect(picker).toHaveText('Headset');
  expect(await page.evaluate(() => (window as any).__asked as string[])).toEqual(
    ['mic-a', 'mic-b'].map((id) => JSON.stringify({ audio: { deviceId: { exact: id } } })),
  );
});

test('leaving Settings while the browser asks for the microphone leaves no microphone open', async ({ page, context }) => {
  await holdMics(context);
  await page.goto('/dashboard/settings?tab=calls');
  await section(page).getByRole('button', { name: 'Test the microphone' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__micsAsked())).toBe(1);
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Calls', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/calls$/);
  await page.evaluate(() => (window as any).__openMic()); // the agent allows it only now
  await expect.poll(() => micStates(page)).toEqual(['ended']);
});

test('on plain HTTP the ringer can still be turned off, and the speaker tested; the microphone says it needs HTTPS', async ({ page, context }) => {
  await context.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false }));
  await page.goto('/dashboard/settings?tab=calls');
  const ringer = page.getByRole('switch', { name: 'Ring for incoming calls' });
  await ringer.click();
  await expect(ringer).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => localStorage.getItem('multiwa:calls:u-ada:ringer'))).toBe('off');
  const s = section(page);
  await expect(s.getByRole('alert')).toContainText('Calls in the dashboard need this page on HTTPS');
  await expect(s.getByRole('button', { name: 'Test the microphone' })).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Turn on desktop alerts' })).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Play a test sound' })).toBeVisible();
});

test('before the browser lists its microphones, the test asks for the one chosen here; the list then shows the one opened, and follows one plugged in', async ({ page, context }) => {
  await context.addInitScript(() => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const device = (deviceId: string, label: string) => ({ deviceId, kind: 'audioinput', label, groupId: deviceId, toJSON() { return this; } });
    // As Firefox and Safari list them until the microphone is allowed: no id, no name.
    w.__devices = [device('', '')];
    w.__asked = [];
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.__asked.push(JSON.stringify(c));
      const stream = await gum({ audio: true });
      // The headset chosen before is not plugged in: the browser opened the desk microphone, and now lists them.
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: 'mic-a' });
      w.__devices = [device('mic-c', 'USB microphone'), device('mic-a', 'Desk microphone')];
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => w.__devices as MediaDeviceInfo[];
    w.__plugIn = () => {
      w.__devices = [...w.__devices, device('mic-d', 'Conference microphone')];
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    };
  });
  await page.goto('/dashboard/settings?tab=calls');
  await page.evaluate(() => localStorage.setItem('multiwa:calls:u-ada:mic', 'mic-b'));
  await page.reload();
  const s = section(page);
  await s.getByRole('button', { name: 'Test the microphone' }).click();
  await expect(s.getByRole('button', { name: 'Stop the test' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__asked as string[])).toEqual([JSON.stringify({ audio: { deviceId: { ideal: 'mic-b' } } })]);
  const picker = s.getByRole('combobox', { name: 'Microphone' });
  await expect(picker).toHaveText('Desk microphone');
  await page.evaluate(() => (window as any).__plugIn());
  await picker.click();
  await expect(page.getByRole('option')).toHaveText(['USB microphone', 'Desk microphone', 'Conference microphone']);
});

test('no microphone plugged in says so', async ({ page, context }) => {
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
  });
  await page.goto('/dashboard/settings?tab=calls');
  await section(page).getByRole('button', { name: 'Test the microphone' }).click();
  await expect(section(page).getByRole('alert')).toHaveText('No microphone found: plug one in and try again');
});

test('a link to a tab that does not exist opens Account', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=nonsense');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Account Information');
});

test('the bell’s Notification Settings opens that tab, from Settings too', async ({ page, backend }) => {
  backend.route(get('/notifications', { notifications: [{ id: 'n-1', type: 'info', title: 'Hello', body: 'A notification', isRead: true, createdAt: '2026-11-01T03:00:00.000Z' }], total: 1 }));
  await page.goto('/dashboard/settings');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByRole('link', { name: 'Notification Settings' }).click();
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true');
});

test('Settings has a Calls tab once a profile answers calls in the dashboard, as the header has its call controls', async ({ page, backend }) => {
  backend.route(get('/profiles', [{ ...PROFILE, settings: {} }]));
  await page.goto('/dashboard/settings?tab=calls'); // a link to the tab opens Account meanwhile
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__socketOpen())).toBe(true);
  await expect(tab(page, 'Calls')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toHaveCount(0);
  backend.emit('call:ringing', ringing()); // a ring: a profile does answer in the dashboard
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeVisible();
  await expect(tab(page, 'Calls')).toBeVisible();
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('has no Calls tab in Settings', async ({ page, backend }) => {
    backend.route(get('/auth/me', { ...ME, role: 'viewer' }));
    await page.goto('/dashboard/settings?tab=calls'); // a link to the tab shows them nothing of it either
    await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Calls')).toHaveCount(0);
    await expect(section(page)).toHaveCount(0);
  });
});

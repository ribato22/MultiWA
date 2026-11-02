import { test, expect, gate, get, on, requestEnded, ringing, ME, PROFILE, type Reply } from './support/fixtures';
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

const tones = (page: Page) => page.evaluate(() => (window as any).__tones as number);
const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
/** Settings → Calls with the console connected: its ringer switch. */
async function ringerSwitch(page: Page) {
  await page.goto('/dashboard/settings?tab=calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  return section(page).getByRole('switch', { name: 'Ring for incoming calls' });
}

test('the ringer follows its switch at once: off, a ringing call goes quiet; on again, it rings', async ({ page, backend }) => {
  const ringer = await ringerSwitch(page);
  backend.emit('call:ringing', ringing());
  await expect.poll(() => tones(page), { timeout: 8000 }).toBeGreaterThan(0);
  await ringer.click();
  const after = await tones(page);
  await page.waitForTimeout(RING_INTERVAL_MS + 500); // a ring cycle
  expect(await tones(page)).toBe(after);
  await expect(banner(page)).toBeVisible(); // still ringing, without a sound
  // On again just after a ring would have come (one every RING_INTERVAL_MS from the first): a ringer that only went
  // quiet would ring at the next one, most of an interval later.
  const on = await page.evaluate(
    (interval) =>
      new Promise<number>((resolve) => {
        const first: number = (window as any).__toneTimes[0];
        const next = first + Math.ceil((performance.now() - first) / interval) * interval;
        setTimeout(() => resolve(performance.now()), next + 200 - performance.now());
      }),
    RING_INTERVAL_MS,
  );
  await ringer.click();
  const rang = () => page.evaluate((at) => ((window as any).__toneTimes as number[]).find((t) => t > at) ?? Infinity, on);
  await expect.poll(rang).toBeLessThan(on + RING_INTERVAL_MS / 2); // at once, not at its next ring
  await expect(section(page)).toContainText('Off: a call still shows its banner, without a sound, even one already ringing.');
});

test('a call that started ringing with the ringer off rings once it is turned on', async ({ page, backend }) => {
  const ringer = await ringerSwitch(page);
  await ringer.click();
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await tones(page)).toBe(0);
  await ringer.click();
  await expect.poll(() => tones(page), { timeout: 1000 }).toBeGreaterThan(0);
});

test('a second call rings once the ringer was turned on while the first rang unheard', async ({ page, backend }) => {
  const ringer = await ringerSwitch(page);
  await ringer.click();
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await ringer.click();
  backend.emit('call:ringing', ringing({ callId: 'call-2', caller: { name: 'Bu Sari', number: '628111000222' } }));
  await expect(banner(page).getByRole('group')).toHaveCount(2);
  const before = await tones(page);
  await expect.poll(() => tones(page), { timeout: RING_INTERVAL_MS + 2000 }).toBeGreaterThan(before);
});

test('the ringer switched in another tab of this browser is followed here at once', async ({ page, context, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
  // Another tab of the site, with no console of its own, switches the ringer: it stores the choice, which this tab hears of.
  const other = await context.newPage();
  await other.goto('/auth/login');
  const ringerTo = (value: 'on' | 'off') => other.evaluate((v) => localStorage.setItem('multiwa:calls:u-ada:ringer', v), value);
  await ringerTo('off');
  backend.emit('call:ringing', ringing());
  await expect(banner(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await tones(page)).toBe(0);
  await ringerTo('on');
  await expect.poll(() => tones(page), { timeout: 1000 }).toBeGreaterThan(0);
  await ringerTo('off');
  const after = await tones(page);
  await page.waitForTimeout(RING_INTERVAL_MS + 500); // a ring cycle
  expect(await tones(page)).toBe(after);
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

test('a link to a tab that does not exist opens Account, and the URL says so', async ({ page }) => {
  await page.goto('/dashboard/settings?tab=nonsense');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Account Information');
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=account$/);
});

test('the bell’s Notification Settings opens that tab, from Settings too, whatever tab was clicked since', async ({ page, backend }) => {
  backend.route(get('/notifications', { notifications: [{ id: 'n-1', type: 'info', title: 'Hello', body: 'A notification', isRead: true, createdAt: '2026-11-01T03:00:00.000Z' }], total: 1 }));
  const bell = async () => {
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await page.getByRole('link', { name: 'Notification Settings' }).click();
  };
  await page.goto('/dashboard/settings');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await bell();
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Team').click();
  await expect(tab(page, 'Team')).toHaveAttribute('aria-selected', 'true');
  await bell(); // the URL named Notifications already
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true');
});

test('a tab click changes the URL in place, with no request to the server', async ({ page }) => {
  await page.goto('/dashboard/settings');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  // A request for the page's server components (RSC) carries this header, or `_rsc=` in its URL.
  const asked: string[] = [];
  page.on('request', (r) => void ((r.headers().rsc === '1' || r.url().includes('_rsc=')) && asked.push(r.url())));
  await tab(page, 'Team').click();
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=team$/);
  await tab(page, 'Security').click();
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=security$/);
  await expect(tab(page, 'Security')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(500); // a request would be out by now
  expect(asked).toEqual([]);
});

test('the bell’s Notification Settings opens that tab after a click on another, while the server is slow to answer', async ({ page, backend }) => {
  backend.route(get('/notifications', { notifications: [{ id: 'n-1', type: 'info', title: 'Hello', body: 'A notification', isRead: true, createdAt: '2026-11-01T03:00:00.000Z' }], total: 1 }));
  await page.goto('/dashboard/settings?tab=notifications');
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true');
  // The page's server answers its navigations two seconds late, as on a slow link.
  await page.route((url) => url.port === '3901', async (route) => {
    if (route.request().headers().rsc === '1') await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fallback();
  });
  await tab(page, 'Team').click();
  await expect(tab(page, 'Team')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByRole('link', { name: 'Notification Settings' }).click();
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=notifications$/);
  await page.waitForTimeout(2500); // whatever the server still had to answer
  await expect(tab(page, 'Notifications')).toHaveAttribute('aria-selected', 'true');
});

test('the Settings links of the sidebar and the account menu open Account, whatever tab was shown', async ({ page }) => {
  await page.goto('/dashboard/settings');
  await tab(page, 'Team').click();
  await expect(tab(page, 'Team')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/dashboard\/settings$/);
  await tab(page, 'Security').click();
  await expect(tab(page, 'Security')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
});

test('the tab clicked is in the URL: a reload keeps it, and so does Back from another page', async ({ page }) => {
  await page.goto('/dashboard/settings');
  await tab(page, 'Security').click();
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=security$/);
  await page.reload();
  await expect(tab(page, 'Security')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('link', { name: 'Calls', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/calls$/);
  await page.goBack();
  await expect(tab(page, 'Security')).toHaveAttribute('aria-selected', 'true');
});

test('a link to the Calls tab waits until the console knows whether a profile answers calls here: Account never shows first', async ({ page, context, backend }) => {
  await context.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Account') (window as any).__accountShown = true;
    }).observe(document, { childList: true, subtree: true, attributes: true });
  });
  const slow = gate();
  backend.route(on('GET', '/profiles', async () => {
    await slow.passed;
    return { json: [PROFILE] };
  }));
  const me = requestEnded(page, '/auth/me');
  await page.goto('/dashboard/settings?tab=calls');
  await me;
  await page.waitForTimeout(500); // the page would show a tab by now
  // Meanwhile the other tabs are there, and the Calls tab keeps its place unseen: no tab moves when the answer comes.
  await expect(tab(page, 'API & Webhooks')).toBeVisible();
  await expect(tab(page, 'Calls')).toHaveCount(0);
  // The Calls panel says it is loading, to a screen reader too: its tab, unseen, says nothing.
  const loading = page.getByRole('status').filter({ hasText: 'Loading calls settings' });
  await expect(loading).toBeVisible();
  const before = await tab(page, 'API & Webhooks').boundingBox();
  slow.open();
  await expect(tab(page, 'Calls')).toHaveAttribute('aria-selected', 'true');
  await expect(loading).toHaveCount(0);
  expect(await tab(page, 'API & Webhooks').boundingBox()).toEqual(before);
  expect(await page.evaluate(() => !!(window as any).__accountShown)).toBe(false);
});

test('a link to the Calls tab while the profiles are still being read leaves the other tabs to open', async ({ page, backend }) => {
  backend.route(on('GET', '/profiles', () => new Promise<Reply>(() => undefined))); // the read never answers
  await page.goto('/dashboard/settings?tab=calls');
  await tab(page, 'Team').click();
  await expect(tab(page, 'Team')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Team Members');
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=team$/);
  await expect(tab(page, 'Calls')).toHaveCount(0);
});

test('a link to the Calls tab when the profiles cannot be read opens Account, and the URL says so', async ({ page, backend }) => {
  backend.route(on('GET', '/profiles', { status: 500, json: { message: 'Internal server error' } }));
  await page.goto('/dashboard/settings?tab=calls');
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=account$/);
  await expect(tab(page, 'Calls')).toHaveCount(0);
});

test('Settings has a Calls tab once a profile answers calls in the dashboard, as the header has its call controls; a ring then leaves the tab shown', async ({ page, backend }) => {
  backend.route(get('/profiles', [{ ...PROFILE, settings: {} }]));
  await page.goto('/dashboard/settings?tab=calls'); // no profile answers there: Account
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__socketOpen())).toBe(true);
  await expect(tab(page, 'Calls')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toHaveCount(0);
  backend.emit('call:ringing', ringing()); // a ring: a profile does answer in the dashboard
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeVisible();
  await expect(tab(page, 'Calls')).toBeVisible();
  await expect(tab(page, 'Account')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/dashboard\/settings\?tab=account$/);
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

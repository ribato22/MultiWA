// A call answered with video in the dashboard: the caller's picture in the video tile, the agent's camera from the
// in-call bar, a camera that cannot go on, and a call that goes on as voice. The media runs against the captured
// parameters (no media server): the tracks exist, no frame of the caller comes.
import { test, expect, ringing, CALLER_VIDEO_PRODUCER, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import type { Page } from '@playwright/test';

const banner = (page: Page) => page.getByRole('region', { name: 'Incoming calls' });
const bar = (page: Page) => page.getByRole('group', { name: 'Current call' });
const tile = (page: Page) => page.getByRole('region', { name: 'Video of the call' });
const cameraButton = (page: Page) => bar(page).getByRole('button', { name: 'Camera' });
const produced = (backend: FakeBackend, kind: string) => backend.commands('call:media').filter((a) => a.op === 'produce' && a.kind === kind).length;
/** The state of every camera this page opened (recordCameras), oldest first. */
const cameraStates = (page: Page) => page.evaluate(() => (window as any).__cameras.map((t: MediaStreamTrack) => t.readyState) as string[]);

/** From the next page on, every camera opened is recorded in `__cameras`; `refuse` makes the browser refuse it. */
const recordCameras = (page: Page, refuse = false) =>
  page.addInitScript((refused: boolean) => {
    const w = window as any;
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    w.__cameras = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c?.video && refused) throw new DOMException('Permission denied', 'NotAllowedError');
      const stream = await gum(c);
      w.__cameras.push(...stream.getVideoTracks());
      return stream;
    };
  }, refuse);

async function open(page: Page) {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('switch', { name: 'Available for calls' })).toBeEnabled();
}

/** Answers a video call: the server's reply names the caller's picture, and once the voice is up it says the call is on. */
async function answerVideo(page: Page, backend: FakeBackend, video = true) {
  backend.reply('call:answer', (a) => ({ ...(backend.defaults['call:answer'](a) as object), callerVideoProducerId: CALLER_VIDEO_PRODUCER }));
  backend.emit('call:ringing', ringing({ isVideo: true, video: 'available' }));
  await banner(page).getByRole('button', { name: 'Answer' }).click();
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => produced(backend, 'audio')).toBe(1);
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'agent-producer-1', video });
}

test('a call answered with video shows the caller in a tile, its picture taken after the voice, and the camera starts off', async ({ page, backend }) => {
  await recordCameras(page);
  await open(page);
  await answerVideo(page, backend);
  await expect(tile(page)).toBeVisible();
  const picture = tile(page).getByLabel('Video of Pak Joko');
  await expect.poll(() => picture.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream | null)?.getVideoTracks().length ?? 0)).toBe(1);
  // The voice is produced before the caller's picture is consumed: the server answers WhatsApp on the voice alone.
  const media = backend.commands('call:media');
  const voice = media.findIndex((a) => a.op === 'produce');
  const picturePart = media.findIndex((a) => a.op === 'consume' && a.producerId === CALLER_VIDEO_PRODUCER);
  expect(voice).toBeGreaterThanOrEqual(0);
  expect(picturePart).toBeGreaterThan(voice);
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await cameraStates(page)).toEqual([]); // nothing asked of the camera yet
  await expectAccessible(page, '[aria-label="Video of the call"]');
});

test('the camera: on produces it once, then tells the server; off tells the server and stops it at once; on again reuses the producer', async ({ page, backend }) => {
  await recordCameras(page);
  await open(page);
  await answerVideo(page, backend);
  await cameraButton(page).click();
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page).getByLabel('Your camera')).toBeVisible();
  expect(backend.commands('call:camera')).toEqual([{ callId: 'call-1', on: true }]);
  expect(produced(backend, 'video')).toBe(1);
  expect(await cameraStates(page)).toEqual(['live']);
  await cameraButton(page).click();
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(tile(page).getByLabel('Your camera')).toHaveCount(0);
  expect(backend.commands('call:camera')).toEqual([{ callId: 'call-1', on: true }, { callId: 'call-1', on: false }]);
  expect(await cameraStates(page)).toEqual(['ended']); // the camera's light is off
  await cameraButton(page).click();
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(produced(backend, 'video')).toBe(1); // one camera producer per join: the new track replaces the old
  expect(await cameraStates(page)).toEqual(['ended', 'live']);
  await expectAccessible(page, '[aria-label="Current call"]');
});

test('a camera the browser refuses leaves it off and says why; the server is not asked', async ({ page, backend }) => {
  await recordCameras(page, true);
  await open(page);
  await answerVideo(page, backend);
  await cameraButton(page).click();
  await expect(bar(page).getByRole('alert')).toHaveText('Allow the camera for this site to turn it on');
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(backend.commands('call:camera')).toEqual([]);
});

test('a camera the server does not take is stopped again, and the bar says why', async ({ page, backend }) => {
  await recordCameras(page);
  await open(page);
  await answerVideo(page, backend);
  backend.reply('call:camera', () => ({ ok: false, reason: 'camera_failed', message: 'WhatsApp Web has no camera mute' }));
  await cameraButton(page).click();
  await expect(bar(page).getByRole('alert')).toHaveText('WhatsApp did not take the camera: the caller does not see you');
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => cameraStates(page)).toEqual(['ended']);
});

test('a video call WhatsApp answered as voice shows no tile and no camera', async ({ page, backend }) => {
  await open(page);
  await answerVideo(page, backend, false);
  await expect(bar(page).getByRole('timer', { name: 'Call time' })).toBeVisible();
  await expect(tile(page)).toHaveCount(0);
  await expect(cameraButton(page)).toHaveCount(0);
});

test('Hide video folds the tile to its title, the call going on; Show brings the picture back', async ({ page, backend }) => {
  await open(page);
  await answerVideo(page, backend);
  await tile(page).getByRole('button', { name: 'Hide video' }).click();
  await expect(tile(page).getByLabel('Video of Pak Joko')).toHaveCount(0);
  await expect(tile(page).getByRole('button', { name: 'Show video' })).toHaveAttribute('aria-expanded', 'false');
  await expect(bar(page)).toBeVisible();
  await tile(page).getByRole('button', { name: 'Show video' }).click();
  await expect(tile(page).getByLabel('Video of Pak Joko')).toBeVisible();
});

test('a reload with the camera on gets the call back with its camera, by itself', async ({ page, backend }) => {
  await recordCameras(page);
  await open(page);
  await answerVideo(page, backend);
  await cameraButton(page).click();
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'true');
  backend.reply('call:rejoin', (a) => ({ ...(backend.defaults['call:rejoin'](a) as object), callerVideoProducerId: CALLER_VIDEO_PRODUCER, cameraOn: true }));
  await page.reload();
  // It names its voice, never its camera: the server would answer `moved` to the camera's id, and the call be lost here.
  await expect.poll(() => backend.commands('call:rejoin')).toEqual([{ callId: 'call-1', ifProducerId: 'agent-producer-1' }]);
  await expect.poll(() => backend.commands('call:camera').filter((c) => c.on).length).toBe(2); // on again, after the rejoin
  // The reloaded page's voice is the third producer of the call: the voice before the reload, its camera, then this one.
  backend.emit('call:active', { callId: 'call-1', answeredAt: new Date().toISOString(), agentProducerId: 'agent-producer-3', video: true });
  await expect(cameraButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(tile(page).getByLabel('Your camera')).toBeVisible();
});

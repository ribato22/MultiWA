// The media path end to end, in real Chrome with a REAL mediasoup worker. One page is the engine's WhatsApp Web
// page (fake WhatsApp Web + the engine's hooks, driven through the real WebJsCallMedia). The other is an agent's
// browser (mediasoup-client). Each side plays a tone and the test listens on the other: the caller at 440 Hz,
// the agent at 660 Hz.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { CALL_MEDIA_INIT_SCRIPT, WebJsCallMedia, mediasoupClientBundle, runCallMediaSignal } from '@multiwa/engines';
import { CallMediaService } from './call-media.service';
import type { CallMediaRoom } from './call-media-room';
import {
  WWEBJS_USER_AGENT, agentHearsInPage, launchCallMediaBrowser, micCarriesInPage, openFakeWhatsAppPage, sleep, startAgentPeerInPage,
  until,
} from '../../../testing/call-media-browser';

const PRESENT = 0.05;
const ABSENT = 0.02;

describe('call media path (real mediasoup worker + headless Chrome)', () => {
  let service: CallMediaService;
  let launched: Awaited<ReturnType<typeof launchCallMediaBrowser>>;
  let room: CallMediaRoom | null = null;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    vi.stubEnv('CALLS_MEDIA_ENABLED', 'true');
    vi.stubEnv('CALLS_MEDIA_ANNOUNCED_ADDRESS', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_LISTEN_IP', '127.0.0.1');
    vi.stubEnv('CALLS_MEDIA_PORT', String(45000 + Math.floor(Math.random() * 3000)));
    service = new CallMediaService(new EventEmitter2());
    await service.onModuleInit();
    expect(service.status().worker).toBe('up');
    launched = await launchCallMediaBrowser();
  }, 60_000);
  afterAll(async () => {
    await launched?.close();
    await service?.onModuleDestroy();
    vi.unstubAllEnvs();
  });

  /**
   * The engine's page: the fake WhatsApp Web with the engine's hooks, under the user agent whatsapp-web.js sets (a
   * Chrome 101), under which mediasoup-client's own detection would pick an old handler.
   */
  const openWaPage = () => openFakeWhatsAppPage(launched.browser, launched.url, CALL_MEDIA_INIT_SCRIPT, (p) => p.setUserAgent(WWEBJS_USER_AGENT));

  /** The agent's page: mediasoup-client in, signalling to the current room's agent peer. */
  const openAgentPage = async () => {
    const p = await launched.browser.newPage();
    await p.exposeFunction('__agentSignal', async (op: string, json: string) =>
      JSON.stringify((await runCallMediaSignal(room!.signalingFor('agent'), op, JSON.parse(json))) ?? null),
    );
    await p.goto(launched.url);
    await p.evaluate(mediasoupClientBundle());
    return p;
  };

  it('the agent hears the caller once attached (silence before), and the caller hears the agent while connected', async () => {
    const waPage = await openWaPage();
    const agentPage = await openAgentPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL1');
      // 1. while it rings: the page's bridge, "caller" on silence, on the named handler (never guessed from the user agent)
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'));
      expect(await waPage.evaluate(() => (window as any).__mwBridge.device.handlerName)).toBe('Chrome111');
      // 2. the agent consumes the caller and produces its voice
      const { agentProducerId } = await agentPage.evaluate(startAgentPeerInPage, handle.callerProducerId, 660);
      // 3. answer: the fake connects after 300 ms and plays the caller at 440 Hz, which the agent does not hear until
      // the caller is attached
      await media.answer('CALL1');
      await sleep(1500);
      expect(await agentPage.evaluate(agentHearsInPage, 440)).toBeLessThan(ABSENT);
      const pick = await handle.attachCaller();
      expect(pick).toEqual({ via: 'destination', freshCandidates: 1, fallback: false });
      expect(await until(async () => (await agentPage.evaluate(agentHearsInPage, 440)) > PRESENT, 10_000)).toBe(true);
      // 4. the agent on the microphone: WhatsApp Web's mic carries 660 Hz, and the agent never becomes a caller tap
      const notedBefore = await waPage.evaluate(() => (window as any).__mwCall.noted);
      await handle.connectAgent(agentProducerId);
      expect(await waPage.evaluate(() => (window as any).__mwCall.noted)).toBe(notedBefore);
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
      // 5. off the microphone again
      await handle.disconnectAgent();
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) < ABSENT, 5_000)).toBe(true);
      // 6. close: the page lets go (WhatsApp Web's own playback track stays live), the room closes
      await handle.close();
      expect(await waPage.evaluate(() => (window as any).__mwBridge)).toBeUndefined();
      expect(
        await waPage.evaluate(() =>
          (window as any).__mwCall.taps.every((t: any) => t.stream.getAudioTracks().every((k: MediaStreamTrack) => k.readyState === 'live')),
        ),
      ).toBe(true);
      room.close();
      expect(service.status().activeRooms).toBe(0);
    } finally {
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
      await agentPage.close();
    }
  }, 60_000);

  it('the bridge refuses a call that is not the active one, and a second bridge while one runs', async () => {
    const waPage = await openWaPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL2');
      // refused in the page before any signalling, so the room is still empty and can serve the real start
      await expect(media.startCallMedia('CALL-OTHER', room.signalingFor('page'))).rejects.toThrow('Call is not the active call');
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'));
      await expect(media.startCallMedia('CALL1', room.signalingFor('page'))).rejects.toThrow('Media bridge already running');
      await handle.close();
    } finally {
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
    }
  }, 60_000);

  it('a page reload mid-call: closeCallMedia frees the bridge, and the next call starts on the new document', async () => {
    const waPage = await openWaPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL3');
      await media.startCallMedia('CALL1', room.signalingFor('page'));
      await waPage.reload(); // WhatsApp Web reloads itself: the new document has no bridge, the wrapper's slot is still held
      await waPage.keyboard.press('Shift');
      await expect(media.startCallMedia('CALL1', room.signalingFor('page'))).rejects.toThrow('Media bridge already running');
      await media.closeCallMedia('CALL1'); // the coordinator's teardown, without a handle
      room.close();
      room = await service.createRoom('CALL4');
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page')); // re-evaluates the bundle
      expect(handle.callerProducerId).toBeTruthy();
      await handle.close();
    } finally {
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
    }
  }, 60_000);
});

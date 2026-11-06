// The media path end to end, in real Chrome with a REAL mediasoup worker. One page is the engine's WhatsApp Web
// page (fake WhatsApp Web + the engine's hooks, driven through the real WebJsCallMedia). The other is an agent's
// browser (the admin console's own agent media module). Each side plays a tone and the test listens on the other:
// the caller at 440 Hz, the agent at 660 Hz.
// A video call runs with a plain mediasoup-client agent (startTestAgentInPage): the caller is a 382×344 canvas of CALLER_RGB, the agent's camera a canvas of AGENT_RGB.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { CALL_MEDIA_INIT_SCRIPT, WebJsCallMedia, mediasoupClientBundle, runCallMediaSignal } from '@multiwa/engines';
import { CallMediaService } from './call-media.service';
import type { CallMediaRoom } from './call-media-room';
import {
  AGENT_RGB, BLACK_RGB, CALLER_RGB, NEAR, WWEBJS_USER_AGENT, agentHearsInPage, agentSeesInPage, cameraCarriesInPage, consoleAgentBundle,
  launchCallMediaBrowser, micCarriesInPage, openFakeWhatsAppPage, seeCallerVideoInPage, sleep, startConsoleAgentInPage, startTestAgentInPage, until,
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

  /** The agent's page: the console's agent media module in, signalling to the current room's agent peer. */
  const openAgentPage = async () => {
    const p = await launched.browser.newPage();
    await p.exposeFunction('__agentSignal', async (op: string, json: string) =>
      JSON.stringify((await runCallMediaSignal(room!.signalingFor('agent'), op, JSON.parse(json))) ?? null),
    );
    await p.goto(launched.url);
    await p.evaluate(consoleAgentBundle());
    return p;
  };

  /** The agent's page for a video call: a plain mediasoup-client peer (startTestAgentInPage) on the room's agent peer. */
  const openTestAgentPage = async () => {
    const p = await launched.browser.newPage();
    await p.exposeFunction('__agentSignal', async (op: string, json: string) =>
      JSON.stringify((await runCallMediaSignal(room!.signalingFor('agent'), op, JSON.parse(json))) ?? null),
    );
    await p.goto(launched.url);
    await p.evaluate(mediasoupClientBundle());
    return p;
  };

  it('the agent hears the caller once attached (silence before), and the caller hears the agent while connected and unmuted', async () => {
    const waPage = await openWaPage();
    const agentPage = await openAgentPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL1');
      // 1. while it rings: the page's bridge, "caller" on silence, on the named handler (never guessed from the user agent)
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'));
      expect(await waPage.evaluate(() => (window as any).__mwBridge.device.handlerName)).toBe('Chrome111');
      // 2. the agent consumes the caller and produces its voice
      const { agentProducerId } = await agentPage.evaluate(startConsoleAgentInPage, handle.callerProducerId, 660);
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
      // 5. muted, the caller hears nothing; a microphone switched meanwhile (880 Hz) stays muted, and is heard once unmuted
      await agentPage.evaluate(() => (window as any).__agent.media.setMuted(true));
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) < ABSENT, 5_000)).toBe(true);
      await agentPage.evaluate(async () => {
        const ctx = (window as any).__agent.analyser.context as AudioContext;
        const osc = ctx.createOscillator();
        osc.frequency.value = 880;
        const mic = ctx.createMediaStreamDestination();
        osc.connect(mic);
        osc.start();
        await (window as any).__agent.media.replaceMic(mic.stream.getAudioTracks()[0]);
      });
      let loudest = 0; // over 3 s, the new microphone never reaches the caller
      for (const end = Date.now() + 3_000; Date.now() < end; ) {
        loudest = Math.max(loudest, await waPage.evaluate(micCarriesInPage, 880));
        await sleep(100);
      }
      expect(loudest).toBeLessThan(ABSENT);
      await agentPage.evaluate(() => (window as any).__agent.media.setMuted(false));
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 880)) > PRESENT, 10_000)).toBe(true);
      expect(await waPage.evaluate(micCarriesInPage, 660)).toBeLessThan(ABSENT); // the old microphone is gone
      // 6. the link's stats, with audio flowing both ways: a round trip
      const sample = () => agentPage.evaluate(() => (window as any).__agent.media.sample());
      expect(await until(async () => (await sample()).rttMs != null, 10_000)).toBe(true);
      // 7. off the microphone again
      await handle.disconnectAgent();
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 880)) < ABSENT, 5_000)).toBe(true);
      // 8. close: the page lets go (WhatsApp Web's own playback track stays live), the room closes
      await handle.close();
      expect(await waPage.evaluate(() => (window as any).__mwBridge)).toBeUndefined();
      expect(
        await waPage.evaluate(() =>
          (window as any).__mwCall.taps.every((t: any) => t.stream.getAudioTracks().every((k: MediaStreamTrack) => k.readyState === 'live')),
        ),
      ).toBe(true);
      // the caller's audio stopped coming: the agent's link reads as all lost, not as its last good stats
      expect(await until(async () => (await sample()).lossPct === 100, 5_000)).toBe(true);
      room.close();
      expect(service.status().activeRooms).toBe(0);
    } finally {
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
      await agentPage.close();
    }
  }, 60_000);

  it('an agent that starts muted (a call rebuilt muted) sends silence until it unmutes', async () => {
    const waPage = await openWaPage();
    const agentPage = await openAgentPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL5');
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'));
      const { agentProducerId } = await agentPage.evaluate(startConsoleAgentInPage, handle.callerProducerId, 660, true);
      await media.answer('CALL1');
      await handle.connectAgent(agentProducerId);
      let loudest = 0; // over 3 s on the microphone, the agent never reaches the caller
      for (const end = Date.now() + 3_000; Date.now() < end; ) {
        loudest = Math.max(loudest, await waPage.evaluate(micCarriesInPage, 660));
        await sleep(100);
      }
      expect(loudest).toBeLessThan(ABSENT);
      await agentPage.evaluate(() => (window as any).__agent.media.setMuted(false));
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
      await handle.close();
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

  it("a video call both ways: the agent sees the caller once attached; WhatsApp Web's camera carries the agent while connected, black otherwise; the voice goes on", async () => {
    const waPage = await openWaPage();
    const agentPage = await openTestAgentPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    try {
      room = await service.createRoom('CALL6', { video: true });
      await waPage.evaluate(() => (window as any).__fakeWa.ring('CALL1', true));
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'), { video: true });
      expect(handle.callerVideoProducerId).toBe(room.producerId('caller', 'video'));
      const { agentProducerId, agentVideoProducerId } = await agentPage.evaluate(startTestAgentInPage, 660, AGENT_RGB);
      await agentPage.evaluate(seeCallerVideoInPage, handle.callerVideoProducerId);
      expect(await media.answer('CALL1', { video: true })).toMatchObject({ video: true });
      expect(await handle.attachCallerVideo()).toEqual({ width: 382, height: 344 });
      expect(await until(async () => (await agentSeesInPage(agentPage, CALLER_RGB)) < NEAR, 10_000)).toBe(true);
      // the voice, with the camera still off: WhatsApp Web's camera is black
      await handle.attachCaller();
      await handle.connectAgent(agentProducerId);
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 10_000)).toBe(true);
      expect(await until(async () => (await cameraCarriesInPage(waPage, BLACK_RGB)) < NEAR, 5_000)).toBe(true);
      // the camera on
      await handle.connectAgentVideo(agentVideoProducerId);
      await handle.setCameraMuted(false);
      expect(await until(async () => (await cameraCarriesInPage(waPage, AGENT_RGB)) < NEAR, 10_000)).toBe(true);
      // the worker holds what the page sends to the room's ceiling
      const pageSend = [...(room as any).transports.values()].find((t: any) => t.peer === 'page' && t.direction === 'send').transport;
      expect(await until(async () => (await pageSend.getStats())[0]?.maxIncomingBitrate === 1_500_000, 5_000)).toBe(true);
      // the camera off
      await handle.disconnectAgentVideo();
      await handle.setCameraMuted(true);
      expect(await until(async () => (await cameraCarriesInPage(waPage, BLACK_RGB)) < NEAR, 5_000)).toBe(true);
      expect(await waPage.evaluate(() => (window as any).__fakeWa.videoMutes)).toEqual([false, true]);
      expect(await until(async () => (await waPage.evaluate(micCarriesInPage, 660)) > PRESENT, 5_000)).toBe(true); // the voice went on throughout
      await handle.close();
    } finally {
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
      await agentPage.close();
    }
  }, 60_000);

  it('a video bridge on a voice room is a voice bridge: the room refuses the video, the engine says why, the voice is as always', async () => {
    const waPage = await openWaPage();
    const media = new WebJsCallMedia(() => waPage, () => true, 'p1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      room = await service.createRoom('CALL7');
      await waPage.evaluate(() => (window as any).__fakeWa.ring('CALL1', true));
      const handle = await media.startCallMedia('CALL1', room.signalingFor('page'), { video: true });
      expect([handle.callerProducerId, handle.callerVideoProducerId]).toEqual([room.producerId('caller'), null]);
      expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('no video'))).toEqual([
        '[WhatsApp-WebJS] Call CALL1 for profile p1: no video, the call goes on as voice: Audio only',
      ]);
      await expect(handle.attachCallerVideo()).rejects.toThrow('No video on this call');
      await handle.close();
    } finally {
      warn.mockRestore();
      await media.closeCallMedia('CALL1');
      room?.close();
      await waPage.close();
    }
  }, 60_000);
});

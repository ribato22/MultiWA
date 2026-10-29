// The call-media page functions in a real headless Chrome, against a FAKE WhatsApp Web: the same
// CALL_MEDIA_INIT_SCRIPT and page functions the engine injects, the same Chrome flags, with WA Web's modules
// replaced by small fakes:
// - acceptCall connects after 300 ms;
// - "WhatsApp's playback" is an oscillator connected to AudioContext.destination;
// - "WhatsApp's mic capture" is the getUserMedia it gets.
// It proves the guards, the answer flow, that the injected mic carries the announcement, the stereo
// recording (L caller, R heard) and the hang-up, without WhatsApp. Automated form of spike B's selftest.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  CALL_MEDIA_CHROME_ARGS,
  CALL_MEDIA_INIT_SCRIPT,
  answerActiveCall,
  hangUpActiveCall,
  playAnnouncementInPage,
  probeCallMedia,
  prepareCallMediaPage,
  startRecordingInPage,
  stopRecordingInPage,
} from '@multiwa/engines';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const engines = createRequire(path.join(REPO_ROOT, 'packages/engines/package.json'));
const puppeteer = createRequire(engines.resolve('whatsapp-web.js'))('puppeteer');

/** A 16-bit mono WAV of a sine tone: the announcement fixture, built here so no binary lives in git. */
function sineWav(hz: number, seconds: number, rate = 16000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 0x7fff), 44 + i * 2);
  return b;
}

/** Fake WhatsApp Web modules: only what the call recipes touch. */
function installFakeWhatsApp() {
  const w = window as any;
  const fake: any = (w.__fakeWa = { endCalls: [], gumStream: null, level: () => 0 });
  const call: any = { id: 'CALL1', state: 3, getState() { return this.state; } };
  const CC: any = { activeCall: call };
  let playback: any = null;
  const stack = {
    type: 'web',
    async acceptCall() {
      call.state = 4;
      // WhatsApp's playback (the caller): an oscillator to the destination, like the direct route.
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start();
      playback = { ctx, osc };
      // WhatsApp's mic capture: it asks for the microphone like WAWebVoipAcquireMediaStream does.
      fake.gumStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(fake.gumStream).connect(an);
      const buf = new Float32Array(an.fftSize);
      fake.level = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
      setTimeout(() => { call.state = 6; }, 300);
    },
    async endCall(reason: number, flag: boolean) {
      fake.endCalls.push([reason, flag]);
      CC.activeCall = null;
      playback?.osc.stop();
    },
  };
  const modules: Record<string, any> = {
    WAWebCallCollection: CC,
    WAWebVoipCallStateUtils: { isCallIncoming: (s: number) => s === 3 || s === 8, isCallConnected: (s: number) => s === 6 || s === 11 },
    WAWebVoipStackInterface: { getVoipStackInterface: async () => stack },
    WAWebVoipSignalingEnums: { EndCallReason: { Self: 1 } },
    WAWebCallRingtone: { stopCallRingtone() {} },
    WAWebVoipCallAudioUnlock: { prepareCallAudioElement() {} },
    WAWebVoipGatingUtils: { isWebCallingUiEnabled: () => true },
  };
  w.require = (name: string) => { if (!(name in modules)) throw new Error(`unknown module ${name}`); return modules[name]; };
  w._multiwaCallId = 'CALL1';
  w.Debug = { VERSION: '2.3000.test' };
}

describe('call media in a real browser (fake WhatsApp Web)', () => {
  let server: Server;
  let browser: any;
  let page: any;
  const chunks: Buffer[] = [];

  beforeAll(async () => {
    server = createServer((_q, res) => res.end('<!doctype html><title>call media</title>')).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', ...CALL_MEDIA_CHROME_ARGS],
    });
    page = await browser.newPage();
    await page.evaluateOnNewDocument(installFakeWhatsApp);
    await page.evaluateOnNewDocument(CALL_MEDIA_INIT_SCRIPT);
    await page.exposeFunction('__mwRecordingChunk', (b64: string) => { chunks.push(Buffer.from(b64, 'base64')); });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`);
    await page.keyboard.press('Shift');
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('prepares the page and reports support', async () => {
    expect(await page.evaluate(prepareCallMediaPage)).toEqual({ hooks: true, micPermission: 'granted' });
    expect(await page.evaluate(probeCallMedia)).toEqual({ reasons: [], waVersion: '2.3000.test' });
  });

  it('refuses another call id, then answers the active call once it connects', async () => {
    await expect(page.evaluate(answerActiveCall, 'OTHER', 5000)).rejects.toThrow('Call is not the active call');
    const r = await page.evaluate(answerActiveCall, 'CALL1', 5000);
    expect(r.connectedAfterMs).toBeGreaterThanOrEqual(250);
    expect(await page.evaluate(() => (window as any).__mwCall.gumCalls)).toBe(1); // WhatsApp took the injected mic
  });

  it('the announcement reaches the injected microphone, and the agent input is restored after it', async () => {
    const levels: number[] = [];
    const playing = page.evaluate(playAnnouncementInPage, sineWav(660, 1.5).toString('base64'));
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 150)); levels.push(await page.evaluate(() => (window as any).__fakeWa.level())); }
    const r = await playing;
    expect(r.durationMs).toBe(1500);
    expect(Math.max(...levels)).toBeGreaterThan(0.05);
    expect(await page.evaluate(() => (window as any).__mwCall.inputs.agent.gain.value)).toBe(1);
  });

  it('records stereo: the caller on the left, what the caller hears on the right', async () => {
    expect(await page.evaluate(startRecordingInPage, 1000)).toEqual({ callerVia: 'destination' });
    await page.evaluate(playAnnouncementInPage, sineWav(660, 2).toString('base64'));
    const stop = await page.evaluate(stopRecordingInPage);
    expect(stop.durationMs).toBeGreaterThanOrEqual(1900);
    const webm = Buffer.concat(chunks);
    expect(webm.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML header
    const ch = await page.evaluate(async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.buffer);
      const rms = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
      return { channels: buf.numberOfChannels, left: rms(buf.getChannelData(0)), right: rms(buf.getChannelData(1)) };
    }, webm.toString('base64'));
    expect(ch.channels).toBe(2);
    expect(ch.left).toBeGreaterThan(0.05);  // the 440 Hz "caller"
    expect(ch.right).toBeGreaterThan(0.05); // the 660 Hz announcement the caller heard
  });

  it('hangs up the way the End button does', async () => {
    await expect(page.evaluate(hangUpActiveCall, 'OTHER')).rejects.toThrow('Call is not the active call');
    await page.evaluate(hangUpActiveCall, 'CALL1');
    expect(await page.evaluate(() => (window as any).__fakeWa.endCalls)).toEqual([[1, true]]);
  });
}, 120_000);

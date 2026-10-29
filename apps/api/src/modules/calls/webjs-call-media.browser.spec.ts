// The call-media page functions in a real headless Chrome, against a FAKE WhatsApp Web: the same
// CALL_MEDIA_INIT_SCRIPT and page functions the engine injects, the same Chrome flags, with WA Web's modules
// replaced by small fakes:
// - acceptCall connects after 300 ms (or never, with `hangAccept`);
// - getVoipStackInterface answers at once (or never, with `hangStack`, or only after a busy page, `stackBusyMs`);
// - "WhatsApp's playback" is an oscillator connected to AudioContext.destination;
// - "WhatsApp's mic capture" is the getUserMedia it gets.
// It proves the guards, the answer flow and its timeout (which also bounds the stack lookup and the accept),
// that the injected mic carries the announcement (and holds the agent meanwhile, and gives the line back when
// an announcement never ends), the stereo recording (L caller, R heard, checked by tone), one recorder at a
// time, its recovery from a failed chunk delivery and the hang-up, without WhatsApp. Automated form of spike
// B's selftest.mjs.
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
  const fake: any = (w.__fakeWa = { endCalls: [], gumStream: null, level: () => 0, hangAccept: false, connectAfterMs: 300, accepts: 0, hangStack: false, releaseStack: null, stackBusyMs: 0 });
  const call: any = { id: 'CALL1', state: 3, getState() { return this.state; } };
  const CC: any = { activeCall: call };
  // The same call object rings again as `id` (for the tests that run after the hang-up).
  fake.ring = (id: string) => { call.id = id; call.state = 3; CC.activeCall = call; w._multiwaCallId = id; };
  let playback: any = null;
  const stack = {
    type: 'web',
    async acceptCall() {
      fake.accepts++;
      if (fake.hangAccept) return new Promise<void>(() => {}); // a voip stack that never answers
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
      setTimeout(() => { call.state = 6; }, fake.connectAfterMs);
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
    WAWebVoipStackInterface: {
      getVoipStackInterface: async () => {
        // a busy page: the main thread is blocked, so the answer's timer cannot run before the lookup returns
        for (const end = Date.now() + fake.stackBusyMs; Date.now() < end; ) { /* spin */ }
        // a lookup that never answers, until the test releases it (late)
        if (fake.hangStack) await new Promise<void>((resolve) => { fake.releaseStack = resolve; });
        return stack;
      },
    },
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
  let failChunks = false; // the Node side of the recording binding throws while this is set

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
    await page.exposeFunction('__mwRecordingChunk', (b64: string) => {
      if (failChunks) throw new Error('chunk sink down');
      chunks.push(Buffer.from(b64, 'base64'));
    });
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

  it('the announcement reaches the injected microphone, holds the agent meanwhile, and restores it after', async () => {
    const levels: number[] = [];
    const gains: number[] = [];
    const playing = page.evaluate(playAnnouncementInPage, sineWav(660, 1.5).toString('base64'));
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 150));
      levels.push(await page.evaluate(() => (window as any).__fakeWa.level()));
      gains.push(await page.evaluate(() => (window as any).__mwCall.inputs.agent.gain.value));
    }
    const r = await playing;
    expect(r.durationMs).toBe(1500);
    expect(Math.max(...levels)).toBeGreaterThan(0.05);
    expect(gains).toContain(0); // the agent input is silent WHILE the announcement plays
    expect(await page.evaluate(() => (window as any).__mwCall.inputs.agent.gain.value)).toBe(1);
  });

  it('refuses a second announcement while one plays, and a failed announcement does not block the next', async () => {
    const gain = () => page.evaluate(() => (window as any).__mwCall.inputs.agent.gain.value);
    const first = page.evaluate(playAnnouncementInPage, sineWav(660, 1.5).toString('base64'));
    await new Promise((r) => setTimeout(r, 300));
    await expect(page.evaluate(playAnnouncementInPage, sineWav(660, 0.3).toString('base64'))).rejects.toThrow('Announcement already playing');
    expect(await gain()).toBe(0); // the refused one did not hand the line back to the agent early
    expect((await first).durationMs).toBe(1500);
    expect(await gain()).toBe(1);
    // not audio: decodeAudioData rejects, and the guard must be released all the same
    await expect(page.evaluate(playAnnouncementInPage, Buffer.from('not audio').toString('base64'))).rejects.toThrow();
    expect((await page.evaluate(playAnnouncementInPage, sineWav(660, 0.3).toString('base64'))).durationMs).toBe(300);
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
      // amplitude of one frequency (single-bin DFT), to tell WHICH tone sits in WHICH channel
      const tone = (x: Float32Array, hz: number) => { const w = (2 * Math.PI * hz) / buf.sampleRate; let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); } return Math.hypot(re, im) / x.length; };
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      return { channels: buf.numberOfChannels, left: rms(L), right: rms(R), l440: tone(L, 440), l660: tone(L, 660), r440: tone(R, 440), r660: tone(R, 660) };
    }, webm.toString('base64'));
    expect(ch.channels).toBe(2);
    expect(ch.left).toBeGreaterThan(0.05);  // the 440 Hz "caller"
    expect(ch.right).toBeGreaterThan(0.05); // the 660 Hz announcement the caller heard
    expect(ch.l440).toBeGreaterThan(ch.l660 * 5); // left = the caller, not the announcement
    expect(ch.r660).toBeGreaterThan(ch.r440 * 5); // right = the announcement, not the caller
  });

  it('recovers from a failed chunk delivery: stopping clears the recorder, so the next recording starts', async () => {
    failChunks = true;
    try {
      await page.evaluate(startRecordingInPage, 200);
      await new Promise((r) => setTimeout(r, 500));
      await expect(page.evaluate(stopRecordingInPage)).rejects.toThrow('chunk sink down');
    } finally {
      failChunks = false;
    }
    const before = chunks.length;
    expect(await page.evaluate(startRecordingInPage, 200)).toEqual({ callerVia: 'destination' }); // not "Already recording"
    await new Promise((r) => setTimeout(r, 500));
    expect((await page.evaluate(stopRecordingInPage)).durationMs).toBeGreaterThanOrEqual(400);
    expect(chunks.length).toBeGreaterThan(before);
  });

  it('refuses a second recording started before any caller audio exists: one recorder, the other is refused', async () => {
    // No tap yet: both starts pass the first "Already recording" check and wait in the tap loop, with the
    // recorder still unclaimed. Whoever leaves the loop first must claim it; the other must be refused.
    await page.evaluate(() => { const c = (window as any).__mwCall; c.savedTaps = c.taps; c.taps = []; });
    const restoreTaps = () => page.evaluate(() => { const c = (window as any).__mwCall; c.taps = c.savedTaps; });
    try {
      const both = Promise.allSettled([page.evaluate(startRecordingInPage, 1000), page.evaluate(startRecordingInPage, 1000)]);
      await new Promise((r) => setTimeout(r, 200));
      await restoreTaps();
      const settled = await both;
      const refused = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0].reason?.message).toContain('Already recording');
      expect((await page.evaluate(stopRecordingInPage)).durationMs).toBeGreaterThanOrEqual(0); // the one recorder stops cleanly
    } finally {
      await restoreTaps();
    }
  });

  it('hangs up the way the End button does', async () => {
    await expect(page.evaluate(hangUpActiveCall, 'OTHER')).rejects.toThrow('Call is not the active call');
    await page.evaluate(hangUpActiveCall, 'CALL1');
    expect(await page.evaluate(() => (window as any).__fakeWa.endCalls)).toEqual([[1, true]]);
  });

  it('gives up at the timeout when the call is accepted but never connects', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.connectAfterMs = 60_000; });
    try {
      await expect(page.evaluate(answerActiveCall, 'CALL2', 600)).rejects.toThrow('Call did not connect in time');
    } finally {
      await page.evaluate(() => { (window as any).__fakeWa.connectAfterMs = 300; });
    }
  }, 15_000);

  it('bounds the whole answer by its timeout, also when the voip stack never accepts', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.hangAccept = true; });
    const t0 = Date.now();
    try {
      await expect(page.evaluate(answerActiveCall, 'CALL2', 500)).rejects.toThrow('Call did not connect in time');
    } finally {
      await page.evaluate(() => { (window as any).__fakeWa.hangAccept = false; });
    }
    expect(Date.now() - t0).toBeLessThan(5000); // not puppeteer's protocol timeout (minutes)
  }, 15_000);

  it('bounds the voip stack lookup by the same deadline, and never accepts after it', async () => {
    const accepts = () => page.evaluate(() => (window as any).__fakeWa.accepts);
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.hangStack = true; f.accepts = 0; });
    const t0 = Date.now();
    try {
      await expect(page.evaluate(answerActiveCall, 'CALL2', 500)).rejects.toThrow('Call did not connect in time');
      expect(Date.now() - t0).toBeLessThan(5000); // not puppeteer's protocol timeout (minutes)
      // the lookup answers late: the answer is over, so acceptCall must not run now
      await page.evaluate(() => (window as any).__fakeWa.releaseStack());
      await new Promise((r) => setTimeout(r, 300));
      expect(await accepts()).toBe(0);
    } finally {
      await page.evaluate(() => { const f = (window as any).__fakeWa; f.hangStack = false; f.releaseStack?.(); });
    }
  }, 15_000);

  it('does not accept when a busy page returns the stack after the deadline but before the timer could run', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.stackBusyMs = 700; f.accepts = 0; });
    try {
      await expect(page.evaluate(answerActiveCall, 'CALL2', 400)).rejects.toThrow('Call did not connect in time');
      expect(await page.evaluate(() => (window as any).__fakeWa.accepts)).toBe(0); // the clock decides, not the late timer
    } finally {
      await page.evaluate(() => { (window as any).__fakeWa.stackBusyMs = 0; });
    }
  }, 15_000);

  it('refuses a call that is not the one WhatsApp Web tracks as ours (_multiwaCallId), without accepting it', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL3'); f.accepts = 0; (window as any)._multiwaCallId = 'CALL9'; });
    try {
      // CALL3 IS the active call and IS ringing: only the _multiwaCallId guard can refuse it
      await expect(page.evaluate(answerActiveCall, 'CALL3', 2000)).rejects.toThrow('Call is not the active call');
      expect(await page.evaluate(() => (window as any).__fakeWa.accepts)).toBe(0);
    } finally {
      await page.evaluate(() => { (window as any)._multiwaCallId = 'CALL3'; });
    }
  });

  it('an announcement that never ends rejects after its length + 5 s, and gives the line back', async () => {
    const line = () => page.evaluate(() => { const c = (window as any).__mwCall; return { gain: c.inputs.agent.gain.value, announcing: c.announcing }; });
    // A suspended context never reaches the end of the buffer. call.ensure() would resume it at once, so
    // resume() is shadowed (own property) for the duration of the test.
    await page.evaluate(async () => { const ctx = (window as any).__mwCall.ctx; await ctx.suspend(); ctx.resume = () => Promise.resolve(); });
    try {
      const t0 = Date.now();
      const outcome = Promise.race([
        page.evaluate(playAnnouncementInPage, sineWav(660, 0.3).toString('base64')).then(() => 'resolved', (e: Error) => e.message),
        new Promise<string>((r) => setTimeout(() => r('still pending after 9 s'), 9000)), // a hang is a failure, not a test timeout
      ]);
      await new Promise((r) => setTimeout(r, 1000));
      expect(await line()).toEqual({ gain: 0, announcing: true }); // held: the agent is silent while it "plays"
      expect(await outcome).toContain('Announcement did not finish');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(5200); // 0.3 s of audio + 5 s
      expect(await line()).toEqual({ gain: 1, announcing: false }); // the finally ran: line back, guard released
    } finally {
      await page.evaluate(async () => { const ctx = (window as any).__mwCall.ctx; delete ctx.resume; await ctx.resume(); });
    }
    expect((await page.evaluate(playAnnouncementInPage, sineWav(660, 0.3).toString('base64'))).durationMs).toBe(300);
  }, 25_000);
}, 120_000);

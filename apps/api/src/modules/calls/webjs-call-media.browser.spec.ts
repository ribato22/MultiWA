// The call-media page functions in a real headless Chrome, against a FAKE WhatsApp Web: the same
// CALL_MEDIA_INIT_SCRIPT and page functions the engine injects, the same Chrome flags, with WA Web's modules
// replaced by small fakes:
// - acceptCall connects after 300 ms (or never, with `hangAccept`);
// - getVoipStackInterface answers at once (or never, with `hangStack`, or only after a busy page, `stackBusyMs`);
// - "WhatsApp's playback" is a 440 Hz oscillator, connected to AudioContext.destination or played through an
//   <audio> element (`playbackVia`), started at accept (or later by the test, with `autoPlayback` off);
// - "WhatsApp's mic capture" is the getUserMedia it gets.
// It proves the guards, the answer flow and its timeout (which also bounds the stack lookup and the accept),
// the hang-up and probe deadlines, that the injected mic carries the announcement (and holds the agent
// meanwhile, and gives the line back when an announcement never ends), the stereo recording (L caller, R heard,
// checked by tone) through both taps and on a page that carried earlier calls, one recorder at a time, its
// handling of failed chunk deliveries and recorder errors, how it picked the caller's tap (the tripwire for a
// wrong pick), that a recording ends with its call (gone from WhatsApp's active call, or ended by the patch's own
// signal) and clears its poll instead of recording the next call, and the real Node wrapper on its own page,
// without WhatsApp: a stop never overtakes its start, a chunk with no sink counts as lost, a guessed caller tap
// is warned about. It automates what was first proven by hand against live WhatsApp Web on 2026-10-29.
// The media bridge runs against a REAL mediasoup router (a worker in this process): the agent is a mediasoup-client
// peer in a second page producing a tone, and the injected microphone is read the way WhatsApp reads it. That proves
// the bridge ends with its call, refuses a call that is over, rolls a failed agent connect back, and leaves
// WhatsApp Web's own tracks alone.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as mediasoup from 'mediasoup';
import { CALL_MEDIA_CHROME_ARGS, CALL_MEDIA_INIT_SCRIPT, WebJsCallMedia, callMediaBridge, callMediaPage, mediasoupClientBundle, runCallMediaSignal } from '@multiwa/engines';
import type { CallMediaHandle } from '@multiwa/engines';

const { answerActiveCall, hangUpActiveCall, playAnnouncementInPage, probeCallMedia, prepareCallMediaPage, startRecordingInPage, stopRecordingInPage } = callMediaPage;
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const engines = createRequire(path.join(REPO_ROOT, 'packages/engines/package.json'));
const puppeteer = createRequire(engines.resolve('whatsapp-web.js'))('puppeteer');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls `ok` until it holds or `ms` passed; returns whether it held. */
const until = async (ok: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await sleep(50);
  return ok();
};
/** What startRecordingInPage reports on a normal call: the one tap that connected after the answer, no guessing. */
const normalPick = (callerVia: 'destination' | 'element') => ({ callerVia, freshCandidates: 1, fallback: false });

/**
 * Page function: `__intervals` holds the ids of the intervals set since and not cleared, so a poll that stops reading
 * but is never cleared would stay there (`liveIntervals`).
 */
function trackIntervals() {
  const w = window as any;
  const live = (w.__intervals = new Set<number>());
  const setIt = w.setInterval.bind(w);
  const clearIt = w.clearInterval.bind(w);
  w.setInterval = (...args: any[]) => { const id = setIt(...args); live.add(id); return id; };
  w.clearInterval = (id: number) => { live.delete(id); clearIt(id); };
}

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
  const fake: any = (w.__fakeWa = {
    endCalls: [], gumStream: null, level: () => 0, hangAccept: false, connectAfterMs: 300, connectTimer: null, accepts: 0,
    hangStack: false, releaseStack: null, stackBusyMs: 0, autoPlayback: true, playbackVia: 'destination', playbacks: [],
  });
  const call: any = { id: 'CALL1', state: 3, getState() { return this.state; } };
  const CC: any = { activeCall: call };
  // The same call object rings again as `id` (for the tests that run after the hang-up), as a NEW call: a connect
  // still pending from the old one must not connect it.
  fake.ring = (id: string) => {
    clearTimeout(fake.connectTimer);
    call.id = id; call.state = 3; delete call.userEndedCall; CC.activeCall = call; w._multiwaCallId = id;
  };
  // WhatsApp's playback of the caller, 440 Hz (or `hz`), on either route WA Web picks: straight to the context's
  // destination (tap B) or through an <audio> element's srcObject (tap A). `ctx` reuses a context, as WA Web may
  // across calls.
  fake.play = (via: string, ctx?: AudioContext, hz = 440) => {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const p: any = { ctx, osc };
    if (via === 'element') {
      const out = ctx.createMediaStreamDestination();
      osc.connect(out);
      p.el = new Audio();
      p.el.srcObject = out.stream;
      p.el.play().catch(() => {});
    } else {
      osc.connect(ctx.destination);
    }
    osc.start();
    fake.playbacks.push(p);
    return p;
  };
  // The end of a call's media: WA Web stops its playback and closes its contexts.
  fake.stopPlaybacks = async () => {
    const ps = fake.playbacks.splice(0);
    for (const p of ps) { try { p.osc.stop(); } catch {} if (p.el) p.el.srcObject = null; }
    await Promise.all([...new Set(ps.map((p: any) => p.ctx))].map((ctx: any) => (ctx.state === 'closed' ? null : ctx.close())));
  };
  const stack = {
    type: 'web',
    async acceptCall() {
      fake.accepts++;
      if (fake.hangAccept) return new Promise<void>(() => {}); // a voip stack that never answers
      call.state = 4;
      if (fake.autoPlayback) fake.play(fake.playbackVia);
      // WhatsApp's mic capture: it asks for the microphone like WAWebVoipAcquireMediaStream does.
      fake.gumStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      fake.capture ??= new AudioContext();
      const an = fake.capture.createAnalyser();
      fake.capture.createMediaStreamSource(fake.gumStream).connect(an);
      const buf = new Float32Array(an.fftSize);
      fake.level = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
      fake.connectTimer = setTimeout(() => { call.state = 6; }, fake.connectAfterMs);
    },
    async endCall(reason: number, flag: boolean) {
      fake.endCalls.push([reason, flag]);
      CC.activeCall = null;
      fake.gumStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      await fake.stopPlaybacks();
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
  let url: string;
  const chunks: Buffer[] = [];
  let deliveries = 0; // calls of the Node side of the recording binding
  let failDelivery: (n: number) => boolean = () => false; // the binding throws on the deliveries this picks

  /** A page with the fake WhatsApp Web and our hooks, like the engine's; no recording binding unless `beforeGoto` adds one. */
  const openPage = async (beforeGoto?: (p: any) => Promise<void>) => {
    const p = await browser.newPage();
    await p.evaluateOnNewDocument(installFakeWhatsApp);
    await p.evaluateOnNewDocument(CALL_MEDIA_INIT_SCRIPT);
    await beforeGoto?.(p);
    await p.goto(url);
    await p.keyboard.press('Shift');
    return p;
  };
  /** A fresh page whose recording binding drops the chunks, for the tests that call the page functions directly. */
  const openRecordingPage = () => openPage((p) => p.exposeFunction('__mwRecordingChunk', (_callId: string, _b64: string) => undefined));

  /**
   * A fresh page with CALL1 answered (the fake caller, 440 Hz, plays from the accept) and a recording of it running;
   * its chunks go to `got`. `__reads` counts the page's looks at WhatsApp's active call: that is what the recorder's
   * poll does, so `looks` tells whether it still runs. `trackIntervals` tells whether the poll is cleared (`liveIntervals`).
   */
  const openRecording = async (got: Buffer[] = []) => {
    const p = await openPage((pg) =>
      pg.exposeFunction('__mwRecordingChunk', (_callId: string, b64: string) => { got.push(Buffer.from(b64, 'base64')); }),
    );
    await p.evaluate(() => {
      const w = window as any;
      const lookUp = w.require;
      w.__reads = 0;
      w.require = (name: string) => { if (name === 'WAWebCallCollection') w.__reads++; return lookUp(name); };
    });
    await p.evaluate(trackIntervals);
    await p.evaluate(answerActiveCall, 'CALL1', 5000);
    const startedAt = Date.now();
    await p.evaluate(startRecordingInPage, 'CALL1', 500);
    return { p, startedAt };
  };
  const recorderState = (p: any) => p.evaluate(() => (window as any).__mwCall.recorder.mr.state);
  /** How many of the intervals set since `openRecording` are still live: the recorder's poll while it records, none after. */
  const liveIntervals = (p: any) => p.evaluate(() => (window as any).__intervals.size);
  /** Makes the page's recorder fail: a track added to the recorded stream errors the MediaRecorder, which then stops. */
  const failRecorder = (p: any) =>
    p.evaluate(() => (window as any).__mwCall.recorder.mr.stream.addTrack(new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0]));
  /** Waits up to `ms` for the page's recorder to stop; whether it did. */
  const recorderStops = async (p: any, ms: number) => {
    const end = Date.now() + ms;
    while ((await recorderState(p)) !== 'inactive') {
      if (Date.now() > end) return false;
      await sleep(50);
    }
    return true;
  };
  /** How often the page looked at WhatsApp's active call during the next `ms`. */
  const looks = (p: any, ms: number) =>
    p.evaluate(async (wait: number) => {
      const w = window as any;
      const before = w.__reads;
      await new Promise((r) => setTimeout(r, wait));
      return w.__reads - before;
    }, ms);

  /** Levels and tones of a WebM recording, decoded in the browser: which tone sits in which channel. */
  const analyze = (webm: Buffer) =>
    page.evaluate(async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes.buffer);
      const rms = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
      // amplitude of one frequency (single-bin DFT), to tell WHICH tone sits in WHICH channel
      const tone = (x: Float32Array, hz: number) => { const w = (2 * Math.PI * hz) / buf.sampleRate; let re = 0, im = 0; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); } return Math.hypot(re, im) / x.length; };
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      return {
        channels: buf.numberOfChannels, left: rms(L), right: rms(R),
        l440: tone(L, 440), l660: tone(L, 660), l880: tone(L, 880), r440: tone(R, 440), r660: tone(R, 660), r880: tone(R, 880),
      };
    }, webm.toString('base64'));

  beforeAll(async () => {
    server = createServer((_q, res) => res.end('<!doctype html><title>call media</title>')).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${(server.address() as any).port}/`;
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', ...CALL_MEDIA_CHROME_ARGS],
    });
    page = await openPage((p) =>
      p.exposeFunction('__mwRecordingChunk', (_callId: string, b64: string) => {
        deliveries++;
        if (failDelivery(deliveries)) throw new Error('chunk sink down');
        chunks.push(Buffer.from(b64, 'base64'));
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  // A failed test must not leave a recorder running into the next one (one that ended with its call is inactive already).
  afterEach(async () => {
    await page.evaluate(() => {
      const c = (window as any).__mwCall;
      if (c?.recorder) {
        if (c.recorder.mr.state !== 'inactive') c.recorder.mr.stop();
        c.recorder.nodes.forEach((n: AudioNode) => n.disconnect());
        c.recorder = null;
      }
    });
  });

  it('prepares the page and reports support', async () => {
    // our hooks are on the document but the page setup has not run: not supported yet
    expect(await page.evaluate(probeCallMedia, 5000)).toEqual({ reasons: ['not_prepared'], waVersion: '2.3000.test' });
    expect(await page.evaluate(prepareCallMediaPage)).toEqual({ hooks: true, micPermission: 'granted' });
    expect(await page.evaluate(probeCallMedia, 5000)).toEqual({ reasons: [], waVersion: '2.3000.test' });
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
    const playing = page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 1.5).toString('base64'));
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
    const first = page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 1.5).toString('base64'));
    await new Promise((r) => setTimeout(r, 300));
    await expect(page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 0.3).toString('base64'))).rejects.toThrow('Announcement already playing');
    expect(await gain()).toBe(0); // the refused one did not hand the line back to the agent early
    expect((await first).durationMs).toBe(1500);
    expect(await gain()).toBe(1);
    // not audio: decodeAudioData rejects, and the guard must be released all the same
    await expect(page.evaluate(playAnnouncementInPage, 'CALL1', Buffer.from('not audio').toString('base64'))).rejects.toThrow();
    expect((await page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 0.3).toString('base64'))).durationMs).toBe(300);
  });

  it('an announcement gives the agent input back the gain it had, not full volume', async () => {
    const gain = (v?: number) => page.evaluate((x?: number) => { const g = (window as any).__mwCall.inputs.agent.gain; if (x !== undefined) g.value = x; return g.value; }, v);
    await gain(0.25); // the agent held low before the announcement
    try {
      await page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 0.3).toString('base64'));
      expect(await gain()).toBe(0.25);
    } finally {
      await gain(1);
    }
  });

  it('records stereo: the caller on the left, what the caller hears on the right', async () => {
    const from = chunks.length;
    expect(await page.evaluate(startRecordingInPage, 'CALL1', 1000)).toEqual(normalPick('destination'));
    await page.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 2).toString('base64'));
    const stop = await page.evaluate(stopRecordingInPage, 'CALL1');
    expect(stop.durationMs).toBeGreaterThanOrEqual(1900);
    const webm = Buffer.concat(chunks.slice(from));
    expect(webm.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML header
    const ch = await analyze(webm);
    expect(ch.channels).toBe(2);
    expect(ch.left).toBeGreaterThan(0.05);  // the 440 Hz "caller"
    expect(ch.right).toBeGreaterThan(0.05); // the 660 Hz announcement the caller heard
    expect(ch.l440).toBeGreaterThan(ch.l660 * 5); // left = the caller, not the announcement
    expect(ch.r660).toBeGreaterThan(ch.r440 * 5); // right = the announcement, not the caller
  });

  it('recovers from a failed chunk delivery: stopping clears the recorder, so the next recording starts', async () => {
    failDelivery = () => true;
    try {
      await page.evaluate(startRecordingInPage, 'CALL1', 200);
      await new Promise((r) => setTimeout(r, 500));
      await expect(page.evaluate(stopRecordingInPage, 'CALL1')).rejects.toThrow('chunk sink down');
    } finally {
      failDelivery = () => false;
    }
    const before = chunks.length;
    expect(await page.evaluate(startRecordingInPage, 'CALL1', 200)).toEqual(normalPick('destination')); // not "Already recording"
    await new Promise((r) => setTimeout(r, 500));
    expect((await page.evaluate(stopRecordingInPage, 'CALL1')).durationMs).toBeGreaterThanOrEqual(400);
    expect(chunks.length).toBeGreaterThan(before);
  });

  it('a failed chunk delivery loses only that chunk: the later ones still arrive, and stop reports the loss', async () => {
    const lost = deliveries + 2; // the 2nd chunk of this recording
    failDelivery = (n) => n === lost;
    try {
      await page.evaluate(startRecordingInPage, 'CALL1', 200);
      await sleep(1200);
      const stop = await page.evaluate(stopRecordingInPage, 'CALL1').then(() => 'resolved', (e: Error) => e.message);
      expect(deliveries - lost).toBeGreaterThanOrEqual(2); // the chunks after the lost one went through
      expect(stop).toMatch(/1 of \d+ recording chunks were not delivered: chunk sink down/);
    } finally {
      failDelivery = () => false;
    }
  });

  it('refuses a second recording started before any caller audio exists: one recorder, the other is refused', async () => {
    // No tap yet: both starts pass the first "Already recording" check and wait in the tap loop, with the
    // recorder still unclaimed. Whoever leaves the loop first must claim it; the other must be refused.
    await page.evaluate(() => { const c = (window as any).__mwCall; c.savedTaps = c.taps; c.taps = []; });
    const restoreTaps = () => page.evaluate(() => { const c = (window as any).__mwCall; c.taps = c.savedTaps; });
    try {
      const both = Promise.allSettled([page.evaluate(startRecordingInPage, 'CALL1', 1000), page.evaluate(startRecordingInPage, 'CALL1', 1000)]);
      await new Promise((r) => setTimeout(r, 200));
      await restoreTaps();
      const settled = await both;
      const refused = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0].reason?.message).toContain('Already recording');
      expect((await page.evaluate(stopRecordingInPage, 'CALL1')).durationMs).toBeGreaterThanOrEqual(0); // the one recorder stops cleanly
    } finally {
      await restoreTaps();
    }
  });

  it('the media calls refuse another call id', async () => {
    await expect(page.evaluate(playAnnouncementInPage, 'OTHER', sineWav(660, 0.3).toString('base64'))).rejects.toThrow('Call is not the active call');
    await expect(page.evaluate(startRecordingInPage, 'OTHER', 1000)).rejects.toThrow('Call is not the active call');
    expect(await page.evaluate(startRecordingInPage, 'CALL1', 1000)).toEqual(normalPick('destination'));
    await expect(page.evaluate(stopRecordingInPage, 'OTHER')).rejects.toThrow('Not recording this call');
    expect((await page.evaluate(stopRecordingInPage, 'CALL1')).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('a node WhatsApp disconnects from the destination leaves the tap too, and disconnect keeps its native behaviour', async () => {
    const r = await page.evaluate(async () => {
      const ctx: any = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      const m = new AudioContext();
      const an = m.createAnalyser();
      m.createMediaStreamSource(ctx.__mwTap.stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const level = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
      await new Promise((res) => setTimeout(res, 300));
      const connected = level();
      gain.disconnect(ctx.destination); // how a page mutes ONE node
      await new Promise((res) => setTimeout(res, 400));
      const disconnected = level();
      let again = 'no error';
      try { gain.disconnect(ctx.destination); } catch (e) { again = (e as Error).name; } // no such connection left: the native error
      osc.stop();
      await ctx.close();
      await m.close();
      return { connected, disconnected, again };
    });
    expect(r.connected).toBeGreaterThan(0.1);
    expect(r.disconnected).toBeLessThan(0.01);
    expect(r.again).toBe('InvalidAccessError');
  });

  it('hangs up the way the End button does', async () => {
    await expect(page.evaluate(hangUpActiveCall, 'OTHER', 5000)).rejects.toThrow('Call is not the active call');
    await page.evaluate(hangUpActiveCall, 'CALL1', 5000);
    expect(await page.evaluate(() => (window as any).__fakeWa.endCalls)).toEqual([[1, true]]);
  });

  it('bounds the hang-up by its timeout when the voip stack never answers, and touches nothing after it', async () => {
    const state = () => page.evaluate(() => ({ ended: (window as any).__fakeWa.endCalls.length, userEndedCall: !!(window as any).require('WAWebCallCollection').activeCall?.userEndedCall }));
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.hangStack = true; });
    const before = await state();
    const t0 = Date.now();
    try {
      const outcome = await Promise.race([
        page.evaluate(hangUpActiveCall, 'CALL2', 300).then(() => 'resolved', (e: Error) => e.message),
        sleep(3000).then(() => 'still pending after 3 s'), // a hang is a failure, not a test timeout
      ]);
      expect(outcome).toContain('Call did not end in time');
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(await state()).toEqual({ ended: before.ended, userEndedCall: false }); // set only once the stack is in hand
      await page.evaluate(() => (window as any).__fakeWa.releaseStack()); // the lookup answers late
      await sleep(300);
      expect(await state()).toEqual({ ended: before.ended, userEndedCall: false }); // and nothing ends after the deadline
    } finally {
      await page.evaluate(() => { const f = (window as any).__fakeWa; f.hangStack = false; f.releaseStack?.(); });
    }
  });

  it('the probe reports voip_stack_unavailable at its deadline when the voip stack never answers', async () => {
    await page.evaluate(() => { (window as any).__fakeWa.hangStack = true; });
    const t0 = Date.now();
    try {
      const outcome = await Promise.race([page.evaluate(probeCallMedia, 300), sleep(3000).then(() => 'still pending after 3 s')]);
      expect(outcome).toEqual({ reasons: ['voip_stack_unavailable'], waVersion: '2.3000.test' });
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      await page.evaluate(() => { const f = (window as any).__fakeWa; f.hangStack = false; f.releaseStack?.(); });
    }
  });

  it('gives up at the timeout when the call is accepted but never connects', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL2'); f.connectAfterMs = 60_000; });
    try {
      await expect(page.evaluate(answerActiveCall, 'CALL2', 600)).rejects.toThrow('Call did not connect in time');
    } finally {
      // the 60-s connect must not fire into a later test, and the fake caller's playback stops here
      await page.evaluate(async () => { const f = (window as any).__fakeWa; f.connectAfterMs = 300; clearTimeout(f.connectTimer); await f.stopPlaybacks(); });
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
    // resume() is shadowed (own property) for the duration of the test. createBufferSource() is shadowed too, to
    // watch the announcement's source: a stopped one ends as soon as the context runs again.
    await page.evaluate(async () => {
      const w = window as any;
      const ctx = w.__mwCall.ctx;
      await ctx.suspend();
      ctx.resume = () => Promise.resolve();
      const create = ctx.createBufferSource.bind(ctx);
      w.__sourceEnded = false;
      ctx.createBufferSource = () => { const s = create(); s.addEventListener('ended', () => { w.__sourceEnded = true; }); return s; };
    });
    try {
      const t0 = Date.now();
      const outcome = Promise.race([
        page.evaluate(playAnnouncementInPage, 'CALL3', sineWav(660, 0.3).toString('base64')).then(() => 'resolved', (e: Error) => e.message),
        new Promise<string>((r) => setTimeout(() => r('still pending after 9 s'), 9000)), // a hang is a failure, not a test timeout
      ]);
      await new Promise((r) => setTimeout(r, 1000));
      expect(await line()).toEqual({ gain: 0, announcing: true }); // held: the agent is silent while it "plays"
      expect(await outcome).toContain('Announcement did not finish');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(5200); // 0.3 s of audio + 5 s
      expect(await line()).toEqual({ gain: 1, announcing: false }); // the finally ran: line back, guard released
    } finally {
      await page.evaluate(async () => { const ctx = (window as any).__mwCall.ctx; delete ctx.resume; delete ctx.createBufferSource; await ctx.resume(); });
    }
    // The context runs again, and the cut-off announcement must not come back: it is not heard on the injected
    // mic, and its source is not still playing (the watchdog path stopped it; a source left started would play
    // its 0.3 s into the call now). The level is sampled over 0.4 s; the source has ended by 150 ms.
    const after = await page.evaluate(async () => {
      const w = window as any;
      let level = 0;
      const sample = async (ms: number) => { for (const end = performance.now() + ms; performance.now() < end; ) { level = Math.max(level, w.__fakeWa.level()); await new Promise((r) => setTimeout(r, 20)); } };
      await sample(150);
      const ended = w.__sourceEnded;
      await sample(250);
      return { level, ended };
    });
    expect(after.level).toBeLessThan(0.01);
    expect(after.ended).toBe(true);
    expect((await page.evaluate(playAnnouncementInPage, 'CALL3', sineWav(660, 0.3).toString('base64'))).durationMs).toBe(300);
  }, 25_000);

  it('without our hooks: the probe says hooks_missing, and the call is not answered', async () => {
    await page.evaluate(() => { const w = window as any; w.__savedMwCall = w.__mwCall; delete w.__mwCall; w.__fakeWa.ring('CALL6'); w.__fakeWa.accepts = 0; });
    try {
      expect((await page.evaluate(probeCallMedia, 2000)).reasons).toEqual(['hooks_missing']);
      // answering anyway would put Chrome's fake microphone (a beep) on the call
      await expect(page.evaluate(answerActiveCall, 'CALL6', 2000)).rejects.toThrow('Call media hooks missing');
      expect(await page.evaluate(() => (window as any).__fakeWa.accepts)).toBe(0);
    } finally {
      await page.evaluate(() => { const w = window as any; w.__mwCall = w.__savedMwCall; delete w.__savedMwCall; });
    }
  });

  it('with our hooks but no successful page setup: not_prepared, until the setup succeeds', async () => {
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      const notPrepared = { supported: false, reasons: ['not_prepared'], waVersion: '2.3000.test' };
      expect(await media.getSupport()).toEqual(notPrepared); // the hooks are there, the setup has not run
      // the setup fails the way a refused microphone permission would
      await p.evaluate(() => { const c = (window as any).__mwCall; c.permittedGetUserMedia = c.realGetUserMedia; c.realGetUserMedia = () => Promise.reject(new Error('Permission denied')); });
      expect(await p.evaluate(prepareCallMediaPage)).toEqual({ hooks: true, micPermission: 'failed: Permission denied' });
      expect(await media.getSupport()).toEqual(notPrepared);
      await p.evaluate(() => { const c = (window as any).__mwCall; c.realGetUserMedia = c.permittedGetUserMedia; });
      expect(await p.evaluate(prepareCallMediaPage)).toEqual({ hooks: true, micPermission: 'granted' });
      expect(await media.getSupport()).toEqual({ supported: true, reasons: [], waVersion: '2.3000.test' });
    } finally {
      await p.close();
    }
  });

  it('records the CURRENT call on a page that carried earlier calls (closed, leaked and reused playback contexts)', async () => {
    await page.evaluate(async () => {
      const f = (window as any).__fakeWa;
      // the playbacks of earlier calls on this document:
      f.reused = f.play('destination').ctx; // a context WhatsApp keeps, and reuses below for this call
      for (let i = 0; i < 2; i++) { const { ctx } = f.play('destination'); await new Promise((r) => setTimeout(r, 100)); await ctx.close(); } // closed: Chrome keeps their tap tracks "live"
      f.play('destination'); // left open
      for (const p of f.playbacks) { try { p.osc.stop(); } catch {} } // the earlier calls ended: all silent now
      f.ring('CALL4');
      f.autoPlayback = false; // this call's playback starts late, below
    });
    try {
      await page.evaluate(answerActiveCall, 'CALL4', 5000);
      const from = chunks.length;
      const started = page.evaluate(startRecordingInPage, 'CALL4', 500);
      await sleep(200);
      await page.evaluate(() => { const f = (window as any).__fakeWa; f.play('destination', f.reused); }); // this call's playback, in the reused context
      expect(await started).toEqual(normalPick('destination')); // the reused context is noted again: the ONE fresh tap
      await sleep(1500);
      await page.evaluate(stopRecordingInPage, 'CALL4');
      const ch = await analyze(Buffer.concat(chunks.slice(from)));
      expect(ch.left).toBeGreaterThan(0.05); // the caller of THIS call, not the dead or silent tap of an earlier one
      expect(ch.l440).toBeGreaterThan(0.1);
      expect(ch.l440).toBeGreaterThan(ch.l660 * 5);
      await page.evaluate(hangUpActiveCall, 'CALL4', 5000);
    } finally {
      await page.evaluate(async () => { const f = (window as any).__fakeWa; f.autoPlayback = true; delete f.reused; await f.stopPlaybacks(); });
    }
  });

  it('records the caller when WhatsApp plays it through an <audio> element (tap A)', async () => {
    await page.evaluate(() => { const f = (window as any).__fakeWa; f.ring('CALL5'); f.playbackVia = 'element'; });
    try {
      await page.evaluate(answerActiveCall, 'CALL5', 5000);
      const from = chunks.length;
      expect(await page.evaluate(startRecordingInPage, 'CALL5', 500)).toEqual(normalPick('element'));
      await sleep(1500);
      await page.evaluate(stopRecordingInPage, 'CALL5');
      const ch = await analyze(Buffer.concat(chunks.slice(from)));
      expect(ch.left).toBeGreaterThan(0.05);
      expect(ch.l440).toBeGreaterThan(0.1);
      expect(ch.l440).toBeGreaterThan(ch.l660 * 5);
      await page.evaluate(hangUpActiveCall, 'CALL5', 5000);
    } finally {
      await page.evaluate(async () => { const f = (window as any).__fakeWa; f.playbackVia = 'destination'; await f.stopPlaybacks(); });
    }
  });

  it('callerTap waits for a tap of the current call, and only then takes an older one still in use', async () => {
    try {
      const r = await page.evaluate(async () => {
        const f = (window as any).__fakeWa;
        const call = (window as any).__mwCall;
        const early = f.play('destination'); // playing before the answer...
        call.answeredAfter = call.noted; // ...that starts in the same millisecond (what answerActiveCall records)
        const t0 = Date.now();
        const old = await call.callerTap(300);
        const waited = Date.now() - t0;
        const current = f.play('destination'); // this call's playback
        const fresh = await call.callerTap(300);
        const pick = (t: any) => t && { freshCandidates: t.freshCandidates, fallback: t.fallback };
        return { waited, old: old?.owner === early.ctx, fresh: fresh?.owner === current.ctx, oldPick: pick(old), freshPick: pick(fresh) };
      });
      expect(r).toEqual({
        waited: expect.any(Number),
        old: true,
        fresh: true,
        oldPick: { freshCandidates: 0, fallback: true }, // the older tap is a fallback, and says so
        freshPick: { freshCandidates: 1, fallback: false },
      });
      expect(r.waited).toBeGreaterThanOrEqual(300);
    } finally {
      await page.evaluate(() => (window as any).__fakeWa.stopPlaybacks());
    }
  });

  it('the real wrapper on its own page: binds the recording, refuses a second start without cutting the first, stops only its call', async () => {
    const page2 = await openPage(); // no binding of its own: the wrapper binds it
    try {
      // without the binding a recording would lose every chunk: refused at once
      await expect(page2.evaluate(startRecordingInPage, 'CALL1', 1000)).rejects.toThrow('Recording binding missing');
      const media = new WebJsCallMedia(() => page2, () => true, 'p1');
      await media.preparePage();
      expect(await page2.evaluate(() => ({ binding: typeof (window as any).__mwRecordingChunk, prepared: (window as any).__mwCall.prepared }))).toEqual({ binding: 'function', prepared: true });
      expect(await media.getSupport()).toEqual({ supported: true, reasons: [], waVersion: '2.3000.test' });
      await media.answer('CALL1'); // the fake caller starts playing at accept
      const first: Buffer[] = [];
      const second: Buffer[] = [];
      await media.startRecording('CALL1', (c) => first.push(c));
      await expect(media.startRecording('CALL1', (c) => second.push(c))).rejects.toThrow('Already recording');
      // the running recording keeps its sink: its first chunk (5-s timeslice) comes AFTER the refused start
      expect(await until(() => first.length > 0, 8000)).toBe(true);
      await expect(media.stopRecording('OTHER')).rejects.toThrow('Not recording this call');
      expect((await media.stopRecording('CALL1')).durationMs).toBeGreaterThanOrEqual(5000);
      expect(second).toHaveLength(0);
      const ch = await analyze(Buffer.concat(first));
      expect(ch.left).toBeGreaterThan(0.05);
      expect(ch.l440).toBeGreaterThan(ch.l660 * 5); // the fake caller, on the left
    } finally {
      await page2.close();
    }
  }, 20_000);

  it('the real wrapper counts a binding puppeteer kept from its own failed attempt as bound', async () => {
    const page3 = await openPage();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // puppeteer takes the binding name before it awaits anything, so an attempt that fails after that leaves it taken
      const expose = page3.exposeFunction.bind(page3);
      let attempts = 0;
      page3.exposeFunction = async (name: string, fn: any) => {
        attempts++;
        await expose(name, fn);
        if (attempts === 1) throw new Error('Protocol error: Target closed');
      };
      const media = new WebJsCallMedia(() => page3, () => true, 'p1');
      await media.preparePage(); // logged, and the rest of the setup still ran
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('recording binding'));
      expect(await page3.evaluate(() => (window as any).__mwCall.prepared)).toBe(true);
      await media.answer('CALL1');
      const got: Buffer[] = [];
      await media.startRecording('CALL1', (c) => got.push(c)); // binds again: "already exists" means still ours
      expect(attempts).toBe(2);
      await sleep(300);
      await media.stopRecording('CALL1');
      expect(got.length).toBeGreaterThan(0); // the chunks come through the binding of the first attempt
    } finally {
      warn.mockRestore();
      await page3.close();
    }
  });

  it.each([
    ['at once', 0],
    ['while its start waits in the page for a caller tap', 300],
  ])('a stop that arrives %s waits for its start instead of overtaking it: no orphan recorder, no stuck slot', async (_when, delayMs) => {
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      await media.preparePage();
      // A fresh page has no caller audio, so the start waits in the page for a tap.
      const order: string[] = [];
      const start = media.startRecording('CALL1', () => undefined).then(() => order.push('start'));
      await sleep(delayMs);
      const stop = media.stopRecording('CALL1').then(() => { order.push('stop'); return 'resolved'; }, (e: Error) => e.message);
      await sleep(300);
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // the caller's audio appears: the start can go on
      await start;
      expect(await stop).toBe('resolved'); // not "Not recording" with the slot freed under the running start
      expect(order).toEqual(['start', 'stop']); // the stop did not overtake the start
      expect(await p.evaluate(() => (window as any).__mwCall.recorder)).toBeNull(); // no orphan recorder left running
      const second: Buffer[] = [];
      await media.startRecording('CALL1', (c) => second.push(c)); // not "Already recording"
      await sleep(300);
      await media.stopRecording('CALL1');
      expect(second.length).toBeGreaterThan(0);
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a stop that waited for a start that failed says "Not recording", not the start\'s error, and the slot is free', async () => {
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      await media.preparePage();
      // CALL9 is not the active call: the start is refused in the page at once
      const start = media.startRecording('CALL9', () => undefined).then(() => 'started', (e: Error) => e.message);
      const stop = media.stopRecording('CALL9').then(() => 'stopped', (e: Error) => e.message);
      expect(await start).toBe('Call is not the active call');
      expect(await stop).toBe('Not recording');
      await expect(media.startRecording('CALL9', () => undefined)).rejects.toThrow('Call is not the active call'); // the page's refusal, not "Already recording"
    } finally {
      await p.close();
    }
  });

  it('stopRecording needs no WhatsApp readiness (the page outlives a disconnect), a start does', async () => {
    const p = await openPage();
    try {
      let ready = true;
      const media = new WebJsCallMedia(() => p, () => ready, 'p1');
      await media.preparePage();
      await media.answer('CALL1'); // the fake caller starts playing at accept
      await media.startRecording('CALL1', () => undefined);
      ready = false; // a `disconnected` event, with the page still alive and our recorder in it
      await expect(media.startRecording('CALL1', () => undefined)).rejects.toThrow('Client not ready');
      expect((await media.stopRecording('CALL1')).durationMs).toBeGreaterThanOrEqual(0); // not "Client not ready"
      expect(await p.evaluate(() => (window as any).__mwCall.recorder)).toBeNull();
    } finally {
      await p.close();
    }
  });

  it('stopRecording with no page at all rejects, and still frees the slot', async () => {
    const stub = { exposeFunction: async () => undefined, evaluate: async () => normalPick('destination') };
    let current: any = stub;
    const media = new WebJsCallMedia(() => current, () => true, 'p1');
    await media.startRecording('CALL1', () => undefined);
    current = null;
    await expect(media.stopRecording('CALL1')).rejects.toThrow('Client not ready');
    current = stub;
    await media.startRecording('CALL1', () => undefined); // not "Already recording"
  });

  it('a chunk that reaches the binding with no recording slot counts as lost instead of vanishing', async () => {
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      await media.preparePage(); // binds
      await media.answer('CALL1');
      await p.evaluate(startRecordingInPage, 'CALL1', 200); // a recorder the wrapper knows nothing about: its chunks have no sink
      await sleep(700);
      await expect(p.evaluate(stopRecordingInPage, 'CALL1')).rejects.toThrow(/recording chunks were not delivered: No recording in progress/);
    } finally {
      await p.close();
    }
  });

  it('a chunk carries its call id: one of another call is lost, not handed to the recording that holds the slot', async () => {
    // An earlier start whose evaluate rejected in Node can leave an orphan recorder in the page; its chunks must
    // never reach the recording of another call.
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      await media.preparePage(); // binds
      const got: Buffer[] = [];
      // A fresh page has no caller audio: the start holds the slot while it waits in the page for a tap.
      const start = media.startRecording('CALL1', (c) => got.push(c));
      start.catch(() => undefined); // a failed assertion closes the page under it: no unhandled rejection on top
      await sleep(300);
      const send = (callId: string) =>
        p.evaluate((id: string) => (window as any).__mwRecordingChunk(id, btoa('x')).then(() => 'delivered', (e: Error) => e.message), callId);
      expect(await send('CALL0')).toBe('Not recording this call');
      expect(got).toHaveLength(0);
      expect(await send('CALL1')).toBe('delivered');
      expect(got.map(String)).toEqual(['x']);
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // the caller's audio appears: the start finishes
      await start;
      await media.stopRecording('CALL1');
    } finally {
      await p.close();
    }
  });

  it('refuses to record a call that ended while its start waited for a caller tap', async () => {
    const p = await openRecordingPage();
    try {
      // a fresh page has no caller audio, so the start waits for a tap
      const start = p.evaluate(startRecordingInPage, 'CALL1', 500).then(() => 'recording', (e: Error) => e.message);
      await sleep(300);
      await p.evaluate(hangUpActiveCall, 'CALL1', 5000); // the call ends meanwhile...
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // ...and a tap turns up all the same
      expect(await start).toBe('Call is not the active call'); // not a recorder on a call that is gone
      expect(await p.evaluate(() => (window as any).__mwCall.recorder)).toBeNull();
    } finally {
      await p.close();
    }
  });

  it('a recording ends with its call: it does not go on to record the next call, and stop reports the time of the end', async () => {
    const got: Buffer[] = [];
    const { p, startedAt } = await openRecording(got);
    try {
      await p.evaluate(playAnnouncementInPage, 'CALL1', sineWav(660, 1.2).toString('base64')); // CALL1's own announcement
      // CALL1 ends: its caller falls silent (WhatsApp keeps the context, and may reuse it) and the next call rings
      await p.evaluate(() => { const f = (window as any).__fakeWa; f.playbacks[0].osc.stop(); f.ring('CALL2'); });
      const ended = Date.now() - startedAt;
      await sleep(1500); // the recorder takes 250-500 ms to see it; the next call's audio only starts after that
      await p.evaluate(() => { const f = (window as any).__fakeWa; f.play('destination', f.playbacks[0].ctx, 880); }); // its caller, same context
      await p.evaluate(playAnnouncementInPage, 'CALL2', sineWav(880, 1).toString('base64')); // and its announcement
      expect(await recorderState(p)).toBe('inactive');
      const stop = await p.evaluate(stopRecordingInPage, 'CALL1'); // the late stop still collects the recording
      expect(stop.durationMs).toBeGreaterThan(1200); // at least CALL1's announcement
      expect(stop.durationMs).toBeLessThan(ended + 1500); // up to the end, not up to this stop, about 2.5 s later
      const ch = await analyze(Buffer.concat(got));
      expect(ch.l440).toBeGreaterThan(0.1); // CALL1's caller was recorded...
      expect(ch.r660).toBeGreaterThan(0.05); // ...and its announcement
      expect(ch.l880).toBeLessThan(0.02); // nothing of the next call, on either channel
      expect(ch.r880).toBeLessThan(0.02);
    } finally {
      await p.close();
    }
  }, 20_000);

  it.each([
    ['the call is hung up', (p: any) => p.evaluate(hangUpActiveCall, 'CALL1', 5000)],
    [
      'the call state cannot be read',
      (p: any) => p.evaluate(() => { const w = window as any; w.require = () => { w.__reads++; throw new Error('module registry gone'); }; }),
    ],
  ])('a recording ends by itself when %s, and its poll ends with it', async (_when, end) => {
    const { p } = await openRecording();
    try {
      expect(await looks(p, 600)).toBeGreaterThan(0); // the recorder polls its call
      expect(await liveIntervals(p)).toBe(1); // the poll is the one interval, so the check below can see it leak
      await end(p);
      expect(await recorderStops(p, 2000)).toBe(true);
      expect(await looks(p, 700)).toBe(0); // and has stopped polling
      expect((await p.evaluate(stopRecordingInPage, 'CALL1')).durationMs).toBeGreaterThan(0); // still collectable
      expect(await liveIntervals(p)).toBe(0); // and its interval is cleared, not just idle
    } finally {
      await p.close();
    }
  }, 20_000);

  it.each([
    ['stopRecording is called', (p: any) => p.evaluate(stopRecordingInPage, 'CALL1')],
    [
      'the recorder fails',
      async (p: any) => {
        await failRecorder(p);
        expect(await recorderStops(p, 2000)).toBe(true);
      },
    ],
  ])('the poll ends with the recorder when %s', async (_when, stop) => {
    const { p } = await openRecording();
    try {
      expect(await looks(p, 600)).toBeGreaterThan(0);
      expect(await liveIntervals(p)).toBe(1);
      await stop(p);
      expect(await looks(p, 700)).toBe(0);
      expect(await liveIntervals(p)).toBe(0);
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a recording also ends when the patch reports its call ended (it clears _multiwaCallId), though the call still holds the slot', async () => {
    const { p, startedAt } = await openRecording();
    try {
      // State 0 alone is no end: a call that was just set reads 0 until its state arrives.
      await p.evaluate(() => { (window as any).require('WAWebCallCollection').activeCall.state = 0; });
      await sleep(800); // several polls
      expect(await recorderState(p)).toBe('recording');
      // What the whatsapp-web.js patch does for a known call that comes back in state 0: it reports the end and clears
      // the id. WhatsApp's active call still holds the call, and an unset id passes the call-id guard.
      await p.evaluate(() => { (window as any)._multiwaCallId = null; });
      const ended = Date.now() - startedAt;
      expect(await recorderStops(p, 1500)).toBe(true);
      await sleep(1500); // the late stop comes long after the end
      const stop = await p.evaluate(stopRecordingInPage, 'CALL1');
      expect(stop.durationMs).toBeGreaterThan(ended); // after the end...
      expect(stop.durationMs).toBeLessThan(ended + 1000); // ...but up to the recorder's stop, not up to this stop, 1.5+ s later
      expect(await liveIntervals(p)).toBe(0);
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a call the patch reports ended while the start waits for a caller tap is refused, not recorded', async () => {
    const p = await openRecordingPage();
    try {
      // a fresh page has no caller audio, so the start waits for a tap
      const start = p.evaluate(startRecordingInPage, 'CALL1', 500);
      start.catch(() => undefined); // asserted below; an earlier failure must not surface as an unhandled rejection
      await sleep(300);
      await p.evaluate(() => { (window as any)._multiwaCallId = null; }); // the patch reports the end; the call stays in the slot
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // a tap turns up all the same
      await expect(start).rejects.toThrow('Call is not the active call');
      expect(await p.evaluate(() => (window as any).__mwCall.recorder)).toBeNull();
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a call the patch never tracked (no _multiwaCallId when the recording starts) is not ended by the unset id', async () => {
    const p = await openRecordingPage();
    try {
      await p.evaluate(() => { delete (window as any)._multiwaCallId; });
      await p.evaluate(answerActiveCall, 'CALL1', 5000);
      await p.evaluate(startRecordingInPage, 'CALL1', 500);
      await sleep(1200); // several polls
      expect(await recorderState(p)).toBe('recording'); // judged by the call-id guard alone
      await p.evaluate(() => (window as any).__fakeWa.ring('CALL2')); // the slot changes: now it ends
      expect(await recorderStops(p, 2000)).toBe(true);
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a recorder that fails is reported by stop, which still frees the slot: the next recording starts', async () => {
    const { p } = await openRecording();
    try {
      await failRecorder(p);
      expect(await recorderStops(p, 2000)).toBe(true);
      // the recording is shorter than its call, and stop says so instead of resolving as if it had ended with the call
      await expect(p.evaluate(stopRecordingInPage, 'CALL1')).rejects.toThrow(/Recorder failed: InvalidModificationError/);
      expect(await p.evaluate(startRecordingInPage, 'CALL1', 500)).toEqual(normalPick('destination')); // not "Already recording"
      await sleep(500);
      expect((await p.evaluate(stopRecordingInPage, 'CALL1')).durationMs).toBeGreaterThanOrEqual(400); // and records fine
    } finally {
      await p.close();
    }
  }, 20_000);

  it('a recorder failure and lost chunks are reported together, in one message', async () => {
    const p = await openPage((pg) => pg.exposeFunction('__mwRecordingChunk', () => { throw new Error('chunk sink down'); }));
    try {
      await p.evaluate(answerActiveCall, 'CALL1', 5000);
      await p.evaluate(startRecordingInPage, 'CALL1', 200);
      await sleep(500); // chunks are lost already
      await failRecorder(p);
      expect(await recorderStops(p, 2000)).toBe(true);
      await expect(p.evaluate(stopRecordingInPage, 'CALL1')).rejects.toThrow(
        /Recorder failed: InvalidModificationError.*; \d+ of \d+ recording chunks were not delivered: chunk sink down/,
      );
    } finally {
      await p.close();
    }
  }, 20_000);

  it('one poll that finds the call gone does not end a recording; the call really gone does', async () => {
    const { p } = await openRecording();
    try {
      // WhatsApp's active call reads empty ONCE, for exactly one poll: the getter puts the call back on its first read
      await p.evaluate(() => {
        const CC = (window as any).require('WAWebCallCollection');
        const call = CC.activeCall;
        Object.defineProperty(CC, 'activeCall', {
          configurable: true,
          get() { Object.defineProperty(CC, 'activeCall', { value: call, writable: true, configurable: true, enumerable: true }); return null; },
        });
      });
      await sleep(1200); // several polls
      const seen = await p.evaluate(() => 'value' in Object.getOwnPropertyDescriptor((window as any).require('WAWebCallCollection'), 'activeCall')!);
      expect(seen).toBe(true); // a poll did read the empty call...
      expect(await recorderState(p)).toBe('recording'); // ...and the recording went on
      await p.evaluate(() => (window as any).__fakeWa.ring('CALL2')); // now it is gone for good
      expect(await recorderStops(p, 2000)).toBe(true);
    } finally {
      await p.close();
    }
  }, 20_000);

  it('startRecordingInPage reports how it chose the caller: one fresh tap is normal, two is a guess', async () => {
    const p = await openRecordingPage();
    try {
      await p.evaluate(answerActiveCall, 'CALL1', 5000); // the fake caller plays at accept: ONE context connects after the answer
      expect(await p.evaluate(startRecordingInPage, 'CALL1', 500)).toEqual(normalPick('destination'));
      await p.evaluate(stopRecordingInPage, 'CALL1');
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // a second context connects after the answer
      expect(await p.evaluate(startRecordingInPage, 'CALL1', 500)).toEqual({ callerVia: 'destination', freshCandidates: 2, fallback: false });
      await p.evaluate(stopRecordingInPage, 'CALL1');
    } finally {
      await p.close();
    }
  });

  it('the real wrapper warns once, naming the profile and the call, when the caller tap is a guess', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = await openPage();
    try {
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      await media.preparePage();
      await media.answer('CALL1'); // one context connects after the answer: nothing to warn about
      await media.startRecording('CALL1', () => undefined);
      await media.stopRecording('CALL1');
      expect(warn).not.toHaveBeenCalled();
      await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // a second one: which is the caller?
      await media.startRecording('CALL1', () => undefined);
      await media.stopRecording('CALL1');
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('Call CALL1 for profile p1');
      expect(line).toContain('2 fresh candidates');
    } finally {
      warn.mockRestore();
      await p.close();
    }
  });

  it('the wrapper warns for the older-tap fallback too, and keeps line breaks out of the log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fallback = { callerVia: 'element', freshCandidates: 0, fallback: true };
      const media = new WebJsCallMedia(() => ({ exposeFunction: async () => undefined, evaluate: async () => fallback }), () => true, 'p\n1');
      await media.startRecording('CALL\n1', () => undefined);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('Call CALL1 for profile p1');
      expect(line).toContain('older tap');
      expect(line).not.toMatch(/[\r\n]/);
    } finally {
      warn.mockRestore();
    }
  });

  it('the wrapper fails closed: a reason it does not know reads as page_error, and a failing probe logs once', async () => {
    const newer = new WebJsCallMedia(() => ({ evaluate: async () => ({ reasons: ['web_calling_disabled', 'from_a_newer_page'], waVersion: 'x' }) }), () => true, 'p1');
    expect(await newer.getSupport()).toEqual({ supported: false, reasons: ['web_calling_disabled', 'page_error'], waVersion: 'x' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const broken = new WebJsCallMedia(() => ({ evaluate: async () => { throw new Error('Execution context was\ndestroyed'); } }), () => true, 'p1');
      expect(await broken.getSupport()).toEqual({ supported: false, reasons: ['page_error'] });
      expect(await broken.getSupport()).toEqual({ supported: false, reasons: ['page_error'] });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Execution context wasdestroyed'); // one line, as clean() makes it
    } finally {
      warn.mockRestore();
    }
  });

  describe('the media bridge, against a real mediasoup router', () => {
    type Op = 'rtpCapabilities' | 'createTransport' | 'connectTransport' | 'produce' | 'consume' | 'resumeConsumer' | 'closeConsumer';
    interface Knobs {
      delay?: Partial<Record<Op, number>>; // the room answers this operation late
      failOnce?: Partial<Record<Op, boolean>>; // the room refuses this operation, once
      badConsume?: boolean; // the room hands out consumer options mediasoup-client cannot use
    }
    let worker: mediasoup.types.Worker;
    let router: mediasoup.types.Router;
    let agentPage: any;
    let agentProducerId = '';

    /**
     * The coordinator's room reduced to what the bridge needs: CallMediaSignaling over the real router, with knobs for
     * a late or refused operation. `ops` is what it was asked, `consumers` what it created (each says if it was closed).
     */
    const makeRoom = (knobs: Knobs = {}) => {
      const transports = new Map<string, mediasoup.types.WebRtcTransport>();
      const consumers: mediasoup.types.Consumer[] = [];
      const ops: Op[] = [];
      const gate = async (op: Op) => {
        ops.push(op);
        if (knobs.failOnce?.[op]) {
          delete knobs.failOnce[op];
          throw new Error(`${op} refused`);
        }
        await sleep(knobs.delay?.[op] ?? 0);
      };
      const transport = (id: string) => transports.get(id)!;
      return {
        ops,
        consumers,
        async rtpCapabilities() { await gate('rtpCapabilities'); return router.rtpCapabilities; },
        async createTransport(_direction: 'send' | 'recv') {
          await gate('createTransport');
          const t = await router.createWebRtcTransport({ listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }] });
          transports.set(t.id, t);
          return { id: t.id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters };
        },
        async connectTransport(id: string, dtlsParameters: unknown) {
          await gate('connectTransport');
          await transport(id).connect({ dtlsParameters: dtlsParameters as mediasoup.types.DtlsParameters });
        },
        async produce(id: string, kind: string, rtpParameters: unknown) {
          await gate('produce');
          const producer = await transport(id).produce({ kind: kind as mediasoup.types.MediaKind, rtpParameters: rtpParameters as mediasoup.types.RtpParameters });
          return { id: producer.id };
        },
        async consume(id: string, producerId: string, rtpCapabilities: unknown) {
          await gate('consume');
          const c = await transport(id).consume({ producerId, rtpCapabilities: rtpCapabilities as mediasoup.types.RtpCapabilities, paused: true });
          consumers.push(c);
          return { id: c.id, producerId, kind: c.kind, rtpParameters: knobs.badConsume ? {} : c.rtpParameters };
        },
        async resumeConsumer(id: string) { await gate('resumeConsumer'); await consumers.find((c) => c.id === id)!.resume(); },
        async closeConsumer(id: string) { await gate('closeConsumer'); consumers.find((c) => c.id === id)?.close(); },
        close() { for (const t of transports.values()) t.close(); },
      };
    };
    type Room = ReturnType<typeof makeRoom>;

    /** A WhatsApp page whose CALL1 rings, with the bridge started on a room of its own through the real wrapper; always cleaned up. */
    const withBridge = async (
      opts: { knobs?: Knobs; before?: (p: any) => Promise<unknown> },
      body: (b: { p: any; media: WebJsCallMedia; room: Room; handle: CallMediaHandle }) => Promise<void>,
    ) => {
      const p = await openPage();
      const media = new WebJsCallMedia(() => p, () => true, 'p1');
      const room = makeRoom(opts.knobs);
      let handle: CallMediaHandle | undefined;
      try {
        await opts.before?.(p);
        handle = await media.startCallMedia('CALL1', room);
        await body({ p, media, room, handle });
      } finally {
        await handle?.close().catch(() => undefined);
        room.close();
        await p.close();
      }
    };

    /** No backstop poll in this page: what the bridge does next is down to its own guards. */
    const holdPolls = (p: any) =>
      p.evaluate(() => {
        const w = window as any;
        const set = w.setInterval.bind(w);
        w.setInterval = (...args: any[]) => (w.__holdPolls ? 0 : set(...args));
        w.__holdPolls = true;
      });
    /** Whether the injected microphone, as WhatsApp captures it, carries sound within `ms`. */
    const heard = (p: any, ms: number) =>
      p.evaluate(async (wait: number) => {
        const f = (window as any).__fakeWa;
        for (const end = performance.now() + wait; performance.now() < end; ) {
          if (f.level() > 0.05) return true;
          await new Promise((r) => setTimeout(r, 25));
        }
        return false;
      }, ms);
    /** The loudest the injected microphone gets over `ms`, after `settleMs`: audio already in flight at a cut still plays out. */
    const micPeak = (p: any, ms: number, settleMs = 0) =>
      p.evaluate(async (wait: number, settle: number) => {
        const f = (window as any).__fakeWa;
        await new Promise((r) => setTimeout(r, settle));
        let peak = 0;
        for (const end = performance.now() + wait; performance.now() < end; ) {
          peak = Math.max(peak, f.level());
          await new Promise((r) => setTimeout(r, 20));
        }
        return peak;
      }, ms, settleMs);
    const hasBridge = (p: any) => p.evaluate(() => !!(window as any).__mwBridge);
    /** Waits up to `ms` for the page to let go of its bridge; whether it did. */
    const bridgeGone = async (p: any, ms: number) => {
      for (const end = Date.now() + ms; (await hasBridge(p)) && Date.now() < end; ) await sleep(50);
      return !(await hasBridge(p));
    };
    const trackPolls = (p: any) => p.evaluate(trackIntervals);
    const ring = (p: any, id: string) => p.evaluate((x: string) => (window as any).__fakeWa.ring(x), id);

    beforeAll(async () => {
      worker = await mediasoup.createWorker({ logLevel: 'warn' });
      router = await worker.createRouter({ mediaCodecs: [{ kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 }] });
      // The agent: a plain mediasoup-client peer in a page of its own, producing a 660 Hz tone into the router.
      const room = makeRoom();
      agentPage = await browser.newPage();
      await agentPage.goto(url);
      await agentPage.exposeFunction('__agentSignal', async (op: string, json: string) => JSON.stringify((await runCallMediaSignal(room, op, JSON.parse(json))) ?? null));
      await agentPage.evaluate(mediasoupClientBundle());
      agentProducerId = await agentPage.evaluate(async () => {
        const w = window as any;
        const sig = async (op: string, args: unknown = {}) => JSON.parse(await w.__agentSignal(op, JSON.stringify(args)));
        const device = new w.mediasoupClient.Device({ handlerName: 'Chrome111' });
        await device.load({ routerRtpCapabilities: await sig('rtpCapabilities') });
        const send = device.createSendTransport(await sig('createTransport', { direction: 'send' }));
        send.on('connect', ({ dtlsParameters }: any, ok: () => void, fail: (e: Error) => void) => {
          sig('connectTransport', { transportId: send.id, dtlsParameters }).then(ok, fail);
        });
        send.on('produce', ({ kind, rtpParameters }: any, ok: (r: { id: string }) => void, fail: (e: Error) => void) => {
          sig('produce', { transportId: send.id, kind, rtpParameters }).then(ok, fail);
        });
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.frequency.value = 660;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        return (await send.produce({ track: dest.stream.getAudioTracks()[0] })).id as string;
      });
    }, 30_000);

    afterAll(async () => {
      await agentPage?.close();
      worker?.close();
    });

    it('the agent reaches the injected microphone through the bridge, and the caller side attaches', async () => {
      await withBridge({}, async ({ p, media, handle }) => {
        await media.answer('CALL1'); // the fake caller plays from the accept
        expect(await handle.attachCaller()).toEqual({ via: 'destination', freshCandidates: 1, fallback: false });
        await handle.connectAgent(agentProducerId);
        expect(await heard(p, 5000)).toBe(true);
        await handle.disconnectAgent();
        expect(await micPeak(p, 400, 300)).toBeLessThan(0.01); // off the microphone by disconnecting, not by gain
      });
    });

    it('the bridge ends with its call: everything it held in the page is released within a second, the agent is off the microphone', async () => {
      await withBridge({ before: trackPolls }, async ({ p, media, handle }) => {
        await media.answer('CALL1');
        await handle.attachCaller();
        await handle.connectAgent(agentProducerId);
        expect(await heard(p, 5000)).toBe(true);
        expect(await liveIntervals(p)).toBe(1); // the backstop poll
        await p.evaluate(() => { (window as any).__held = (window as any).__mwBridge; });
        await ring(p, 'CALL2'); // CALL1 is over: the next call rings
        expect(await bridgeGone(p, 1500)).toBe(true);
        expect(await p.evaluate(() => { const b = (window as any).__held; return { send: b.send.closed, recv: b.recv.closed, agent: b.agent }; })).toEqual({ send: true, recv: true, agent: null });
        expect(await liveIntervals(p)).toBe(0); // the poll ended with the bridge
        expect(await micPeak(p, 400, 300)).toBeLessThan(0.01); // and the microphone carries nothing of CALL1's agent
      });
    });

    it('the engine slot stays held after the page let go, until the coordinator closes', async () => {
      await withBridge({}, async ({ p, media, handle }) => {
        await ring(p, 'CALL2');
        expect(await bridgeGone(p, 1500)).toBe(true);
        const next = makeRoom();
        try {
          await expect(media.startCallMedia('CALL2', next)).rejects.toThrow('Media bridge already running');
          await handle.close(); // nothing left to close in the page; frees the slot
          await (await media.startCallMedia('CALL2', next)).close();
        } finally {
          next.close();
        }
      });
    });

    it('close() clears the poll', async () => {
      await withBridge({ before: trackPolls }, async ({ p, handle }) => {
        expect(await liveIntervals(p)).toBe(1);
        await handle.close();
        expect(await liveIntervals(p)).toBe(0);
        expect(await hasBridge(p)).toBe(false);
      });
    });

    it.each([
      ['the patch reports the call ended (it clears _multiwaCallId)', (p: any) => p.evaluate(() => { (window as any)._multiwaCallId = null; })],
      ['the call state cannot be read', (p: any) => p.evaluate(() => { (window as any).require = () => { throw new Error('module registry gone'); }; })],
    ])('the bridge also ends when %s', async (_when, end) => {
      await withBridge({}, async ({ p }) => {
        await sleep(600); // several polls: a live call keeps its bridge
        expect(await hasBridge(p)).toBe(true);
        await end(p);
        expect(await bridgeGone(p, 1500)).toBe(true);
      });
    });

    it('a call the patch never tracked is not ended by the unset id, and one poll that finds the call gone does not end the bridge', async () => {
      await withBridge({ before: (p) => p.evaluate(() => { delete (window as any)._multiwaCallId; }) }, async ({ p }) => {
        await sleep(1000); // several polls, with the id unset
        expect(await hasBridge(p)).toBe(true); // judged by the call-id guard alone
        // WhatsApp's active call reads empty ONCE, for exactly one poll: the getter puts the call back on its first read
        await p.evaluate(() => {
          const CC = (window as any).require('WAWebCallCollection');
          const call = CC.activeCall;
          Object.defineProperty(CC, 'activeCall', {
            configurable: true,
            get() { Object.defineProperty(CC, 'activeCall', { value: call, writable: true, configurable: true, enumerable: true }); return null; },
          });
        });
        await sleep(1000);
        expect(await p.evaluate(() => 'value' in Object.getOwnPropertyDescriptor((window as any).require('WAWebCallCollection'), 'activeCall')!)).toBe(true); // a poll did read the empty call...
        expect(await hasBridge(p)).toBe(true); // ...and the bridge went on
        await ring(p, 'CALL2'); // now the slot changes for good
        expect(await bridgeGone(p, 1500)).toBe(true);
      });
    });

    it('attach and connect refuse a call that is over, also when the next call has taken its place', async () => {
      await withBridge({ before: holdPolls }, async ({ p, media, room, handle }) => {
        await media.answer('CALL1');
        await ring(p, 'CALL2'); // CALL1 is over; CALL2 is the active call
        await expect(handle.attachCaller()).rejects.toThrow('Call is not the active call');
        await expect(handle.connectAgent(agentProducerId)).rejects.toThrow('Call is not the active call');
        expect(room.ops).not.toContain('consume'); // refused before the room was asked for anything
        expect(await micPeak(p, 500)).toBeLessThan(0.01); // CALL2's microphone carries no agent
      });
    });

    it('an attach whose call ends while it waits for the caller tap leaves the caller on silence', async () => {
      await withBridge({ before: holdPolls }, async ({ p, handle }) => {
        // no playback yet: callerTap waits for one, and the call ends meanwhile
        await p.evaluate(() => {
          const w = window as any;
          const b = w.__mwBridge;
          w.__replaced = 0;
          const replace = b.caller.replaceTrack.bind(b.caller);
          b.caller.replaceTrack = (...args: any[]) => { w.__replaced++; return replace(...args); };
        });
        const attaching = handle.attachCaller().then(() => 'attached', (e: Error) => e.message);
        await sleep(300);
        await ring(p, 'CALL2');
        await p.evaluate(() => { (window as any).__fakeWa.play('destination'); }); // a tap turns up all the same
        expect(await attaching).toBe('Call is not the active call');
        expect(await p.evaluate(() => (window as any).__replaced)).toBe(0);
      });
    });

    it.each([
      ['creates the consumer', { delay: { consume: 600 } }],
      ['resumes it', { delay: { resumeConsumer: 600 } }],
    ] as [string, Knobs][])('a connect whose call ends while the room %s is rolled back: no agent, the room consumer closed', async (_when, knobs) => {
      await withBridge({ knobs, before: holdPolls }, async ({ p, media, room, handle }) => {
        await media.answer('CALL1');
        await handle.attachCaller();
        const connecting = handle.connectAgent(agentProducerId).then(() => 'connected', (e: Error) => e.message);
        await sleep(300);
        await ring(p, 'CALL2'); // the call ends while the room is still busy with it
        expect(await connecting).toBe('Call is not the active call');
        expect(room.consumers.map((c) => c.closed)).toEqual([true]);
        expect(await p.evaluate(() => (window as any).__mwBridge.agent)).toBeNull();
        expect(await micPeak(p, 500, 300)).toBeLessThan(0.01);
      });
    });

    it('a connect whose resume fails is rolled back: no agent kept, the room consumer closed, and the retry connects', async () => {
      const audits = (p: any) =>
        p.evaluate(() => {
          const w = window as any;
          const A = w.Audio;
          w.__audios = [];
          w.Audio = function (...args: any[]) { const el = new A(...args); w.__audios.push(el); return el; };
        });
      await withBridge({ knobs: { failOnce: { resumeConsumer: true } }, before: audits }, async ({ p, media, room, handle }) => {
        await media.answer('CALL1');
        await handle.attachCaller();
        await expect(handle.connectAgent(agentProducerId)).rejects.toThrow('resumeConsumer refused');
        expect(await p.evaluate(() => (window as any).__mwBridge.agent)).toBeNull();
        expect(await p.evaluate(() => (window as any).__audios.map((a: HTMLAudioElement) => a.srcObject))).toEqual([null]); // the keep-alive let go of its stream
        expect(room.consumers.map((c) => c.closed)).toEqual([true]);
        await handle.connectAgent(agentProducerId); // not "Agent already connected"
        expect(await heard(p, 5000)).toBe(true);
      });
    });

    it('a consume mediasoup-client cannot use leaves no consumer behind in the room', async () => {
      await withBridge({ knobs: { badConsume: true } }, async ({ room, handle }) => {
        await expect(handle.connectAgent(agentProducerId)).rejects.toThrow();
        expect(room.consumers.map((c) => c.closed)).toEqual([true]);
      });
    });

    it('connecting the agent wakes a suspended microphone context', async () => {
      await withBridge({}, async ({ p, media, handle }) => {
        await media.answer('CALL1');
        await handle.attachCaller();
        await p.evaluate(() => (window as any).__mwCall.ctx.suspend());
        await handle.connectAgent(agentProducerId);
        expect(await heard(p, 5000)).toBe(true);
      });
    });

    it("attaching the caller never writes to WhatsApp Web's own track", async () => {
      await withBridge({}, async ({ p, media, handle }) => {
        // the caller's playback track, as WhatsApp Web owns it; `enabled` is read, or set when given
        const track = (enabled?: boolean) =>
          p.evaluate((x?: boolean) => {
            const t = (window as any).__fakeWa.playbacks[0].el.srcObject.getAudioTracks()[0];
            if (x !== undefined) t.enabled = x;
            return t.enabled;
          }, enabled);
        await p.evaluate(() => { (window as any).__fakeWa.playbackVia = 'element'; }); // WhatsApp plays the caller through an <audio> element
        await media.answer('CALL1');
        await track(false); // WhatsApp Web has muted its own track
        expect((await handle.attachCaller()).via).toBe('element');
        expect(await track()).toBe(false); // ours leaves it so
      });
    });

    it('refuses to start without our hooks, with a message instead of a TypeError', async () => {
      const p = await openPage();
      try {
        await p.evaluate(() => { delete (window as any).__mwCall; });
        await expect(p.evaluate(callMediaBridge.startBridgeInPage, 'CALL1')).rejects.toThrow('Call media hooks missing');
      } finally {
        await p.close();
      }
    });
  });
}, 120_000);

// Shared helpers for the call-media browser specs (headless Chrome against a FAKE WhatsApp Web). Not a spec, and
// outside src/modules, so neither vitest nor the coverage gate counts it. `installFakeWhatsApp` and every function
// meant for a page run INSIDE the page (evaluateOnNewDocument / evaluate), so they stay self-contained.
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { CALL_MEDIA_CHROME_ARGS } from '@multiwa/engines';

export const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
export const engines = createRequire(path.join(REPO_ROOT, 'packages/engines/package.json'));
export const puppeteer = createRequire(engines.resolve('whatsapp-web.js'))('puppeteer');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls `ok` until it holds or `ms` passed; returns whether it held. */
export const until = async (ok: () => boolean, ms: number) => {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await sleep(50);
  return ok();
};

/** A 16-bit mono WAV of a sine tone: the announcement fixture, built here so no binary lives in git. */
export function sineWav(hz: number, seconds: number, rate = 16000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.5 * 0x7fff), 44 + i * 2);
  return b;
}

/** Fake WhatsApp Web modules: only what the call recipes touch. */
export function installFakeWhatsApp() {
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

/** A local page server and a headless Chrome with the engine's call-media flags. */
export async function launchCallMediaBrowser(): Promise<{ browser: any; url: string; server: Server; close: () => Promise<void> }> {
  const server = createServer((_q, res) => res.end('<!doctype html><title>call media</title>')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  let browser: any;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', ...CALL_MEDIA_CHROME_ARGS],
    });
  } catch (e) {
    server.close(); // the caller gets no handle to close it with
    throw e;
  }
  return { browser, url, server, close: async () => { await browser.close(); server.close(); } };
}

/** A page with the fake WhatsApp Web and the engine's hooks (`initScript`), like the engine's page. */
export async function openFakeWhatsAppPage(browser: any, url: string, initScript: string, beforeGoto?: (p: any) => Promise<void>) {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(installFakeWhatsApp);
  await p.evaluateOnNewDocument(initScript);
  await beforeGoto?.(p);
  await p.goto(url);
  await p.keyboard.press('Shift');
  return p;
}

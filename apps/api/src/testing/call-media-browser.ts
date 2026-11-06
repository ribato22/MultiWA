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
const esbuild = engines('esbuild');
let consoleAgent: string | undefined;
/**
 * The admin console's own agent media module (apps/admin/src/lib/call-console/agent-media.ts) with its mediasoup-client,
 * as one IIFE that defines `consoleAgent`: the media specs run the agent the dashboard runs.
 */
export function consoleAgentBundle(): string {
  consoleAgent ??= esbuild.buildSync({
    entryPoints: [path.join(REPO_ROOT, 'apps/admin/src/lib/call-console/agent-media.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'consoleAgent',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    logLevel: 'warning',
  }).outputFiles[0].text as string;
  return consoleAgent;
}
/** The user agent whatsapp-web.js gives WhatsApp Web (a Mac Chrome 101), so a fake page looks to its scripts like the engine's. */
export const WWEBJS_USER_AGENT: string = createRequire(engines.resolve('whatsapp-web.js'))('whatsapp-web.js').DefaultOptions.userAgent;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Polls `ok` (sync or async) until it holds or `ms` passed; returns whether it held. */
export const until = async (ok: () => boolean | Promise<boolean>, ms: number) => {
  for (const end = Date.now() + ms; !(await ok()) && Date.now() < end; ) await sleep(50);
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
    // Video: `video` says the ringing call is a video call (ring(id, true)). requireBundle loads the video call UI (or
    // fails, `bundleFails`, or hangs, `bundleHangs`, until the test calls `releaseBundle`); only with it loaded does an
    // answer draw the caller, in `callerColour`, unless `drawsCaller` is off. `acceptArgs` and `videoMutes` record those
    // calls (a mute never returns with `hangMute`); `camStream` is the camera the answer took.
    video: false, bundleLoaded: false, bundleFails: false, bundleHangs: false, releaseBundle: null, drawsCaller: true,
    callerColour: [200, 40, 40], callerCanvas: null, callerTimer: null, camStream: null, acceptArgs: [], videoMutes: [], hangMute: false,
  });
  const call: any = { id: 'CALL1', state: 3, getState() { return this.state; } };
  const CC: any = { activeCall: call };
  // The same call object rings again as `id` (for the tests that run after the hang-up), as a NEW call: a connect
  // still pending from the old one must not connect it. `video`: the new call is a video call.
  fake.ring = (id: string, video = false) => {
    clearTimeout(fake.connectTimer);
    fake.stopVideo();
    fake.video = video;
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
  // WhatsApp Web's call view draws the caller's video into a canvas of its own, some 382×344 (live): here a flat colour,
  // redrawn like a video. Called again, it replaces the canvas, as WhatsApp Web may mid-call.
  fake.showCaller = () => {
    const c = document.createElement('canvas');
    c.width = 382;
    c.height = 344;
    const g = c.getContext('2d')!;
    const paint = () => { g.fillStyle = `rgb(${fake.callerColour.join(',')})`; g.fillRect(0, 0, c.width, c.height); };
    paint();
    clearInterval(fake.callerTimer);
    fake.callerTimer = setInterval(paint, 66);
    fake.callerCanvas?.remove();
    document.body.appendChild(c);
    fake.callerCanvas = c;
  };
  // The end of a call's video: the call view goes, and WhatsApp Web stops its camera.
  fake.stopVideo = () => {
    clearInterval(fake.callerTimer);
    fake.callerCanvas?.remove();
    fake.callerCanvas = null;
    fake.camStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    fake.camStream = null;
  };
  const stack: any = {
    type: 'web',
    async acceptCall(...args: unknown[]) {
      fake.accepts++;
      fake.acceptArgs.push(args);
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
      // A video call takes a camera too, also one answered with the camera off or as voice (live: 640×480 ideal).
      if (fake.video) {
        fake.camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
        if (fake.bundleLoaded && fake.drawsCaller) fake.showCaller();
      }
      fake.connectTimer = setTimeout(() => { call.state = 6; }, fake.connectAfterMs);
    },
    async endCall(reason: number, flag: boolean) {
      fake.endCalls.push([reason, flag]);
      CC.activeCall = null;
      fake.gumStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      fake.stopVideo();
      await fake.stopPlaybacks();
    },
    setCallVideoMute(muted: boolean) {
      fake.videoMutes.push(muted);
      if (fake.hangMute) return new Promise<void>(() => {}); // a voip stack that takes the mute and never answers
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
    WAWebVoipUiVideoCallLoadable: {
      async requireBundle() {
        // a bundle that never loads, until the test releases it (late)
        if (fake.bundleHangs) await new Promise<void>((resolve) => { fake.releaseBundle = resolve; });
        if (fake.bundleFails) throw new Error('ChunkLoadError: the video call bundle did not load');
        fake.bundleLoaded = true;
      },
    },
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

/**
 * In the agent's page (consoleAgentBundle() evaluated in): the console's startAgentMedia, with a `hz` tone as the
 * microphone and the page binding `__agentSignal(op, json)` as its signalling, started muted if `muted`. What the agent
 * hears goes to an analyser.
 */
export async function startConsoleAgentInPage(callerProducerId: string, hz: number, muted = false): Promise<{ agentProducerId: string }> {
  const w = window as any;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const mic = ctx.createMediaStreamDestination();
  osc.connect(mic);
  osc.start();
  const media = await w.consoleAgent.startAgentMedia({
    signal: async (op: string, args: unknown) => JSON.parse(await w.__agentSignal(op, JSON.stringify(args ?? {}))),
    callerProducerId,
    iceServers: [],
    mic: mic.stream.getAudioTracks()[0],
    muted,
  });
  const keepAlive = new Audio(); // Chrome feeds a remote track to Web Audio only while a media element plays it
  keepAlive.muted = true;
  keepAlive.srcObject = media.remote;
  keepAlive.play().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  ctx.createMediaStreamSource(media.remote).connect(analyser);
  w.__agent = { analyser, keepAlive, media };
  return { agentProducerId: media.producerId };
}

/** Amplitude of `hz` in what the agent hears (single-bin DFT over the analyser window). */
export function agentHearsInPage(hz: number): number {
  const a: AnalyserNode = (window as any).__agent.analyser;
  const x = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(x);
  const k = (2 * Math.PI * hz) / a.context.sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(k * i); im -= x[i] * Math.sin(k * i); }
  return Math.hypot(re, im) / x.length;
}

/** Amplitude of `hz` on WhatsApp Web's microphone in the fake page, i.e. what the caller hears. Needs an answered call. */
export function micCarriesInPage(hz: number): number {
  const f = (window as any).__fakeWa;
  // Each answer captures a new microphone stream: a page that takes several calls is listened to on the current one.
  if (f.micStream !== f.gumStream) {
    f.micStream = f.gumStream;
    f.micAnalyser = f.capture.createAnalyser();
    f.micAnalyser.fftSize = 8192;
    f.capture.createMediaStreamSource(f.gumStream).connect(f.micAnalyser);
  }
  const a: AnalyserNode = f.micAnalyser;
  const x = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(x);
  const k = (2 * Math.PI * hz) / a.context.sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(k * i); im -= x[i] * Math.sin(k * i); }
  return Math.hypot(re, im) / x.length;
}

/** The fake caller's colour (installFakeWhatsApp paints its caller canvas with it), the test agent's camera, and black. */
export const CALLER_RGB = [200, 40, 40];
export const AGENT_RGB = [40, 40, 200];
export const BLACK_RGB = [0, 0, 0];
/** A picture within this of a colour on every channel (0-255) is that colour: VP8 and the colour conversions move a flat colour a few steps. */
export const NEAR = 40;

/**
 * In a test agent's page (mediasoupClientBundle() evaluated in, the page binding `__agentSignal(op, json)` exposed): a
 * plain mediasoup-client peer with a send and a receive transport, the agent of the video specs. It produces a `hz`
 * tone and a 320×240 camera of colour `rgb`; seeCallerVideoInPage shows it the caller's video.
 */
export async function startTestAgentInPage(hz: number, rgb: number[]): Promise<{ agentProducerId: string; agentVideoProducerId: string }> {
  const w = window as any;
  const sig = async (op: string, args: unknown = {}) => JSON.parse(await w.__agentSignal(op, JSON.stringify(args)));
  const device = new w.mediasoupClient.Device({ handlerName: 'Chrome111' });
  await device.load({ routerRtpCapabilities: await sig('rtpCapabilities') });
  const wire = (t: any) => {
    t.on('connect', ({ dtlsParameters }: any, ok: () => void, fail: (e: Error) => void) => {
      sig('connectTransport', { transportId: t.id, dtlsParameters }).then(ok, fail);
    });
    return t;
  };
  const send = wire(device.createSendTransport(await sig('createTransport', { direction: 'send' })));
  send.on('produce', ({ kind, rtpParameters }: any, ok: (r: { id: string }) => void, fail: (e: Error) => void) => {
    sig('produce', { transportId: send.id, kind, rtpParameters }).then(ok, fail);
  });
  const recv = wire(device.createRecvTransport(await sig('createTransport', { direction: 'recv' })));
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const mic = ctx.createMediaStreamDestination();
  osc.connect(mic);
  osc.start();
  const voice = await send.produce({ track: mic.stream.getAudioTracks()[0] });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const g = canvas.getContext('2d')!;
  g.fillStyle = `rgb(${rgb.join(',')})`;
  g.fillRect(0, 0, 320, 240);
  setInterval(() => g.fillRect(0, 0, 320, 240), 66); // a canvas that does not change sends no frames
  const camera = await send.produce({ track: canvas.captureStream(15).getVideoTracks()[0], encodings: [{ maxBitrate: 800_000 }] });
  const video = document.createElement('video');
  video.muted = true;
  w.__agent = { device, recv, sig, video };
  return { agentProducerId: voice.id, agentVideoProducerId: camera.id };
}

/** In the test agent's page: consume the caller's video (`producerId`) into `__agent.video`, which plays it. */
export async function seeCallerVideoInPage(producerId: string): Promise<void> {
  const a = (window as any).__agent;
  const consumer = await a.recv.consume(await a.sig('consume', { transportId: a.recv.id, producerId, rtpCapabilities: a.device.rtpCapabilities }));
  await a.sig('resumeConsumer', { consumerId: consumer.id });
  a.video.srcObject = new MediaStream([consumer.track]);
  a.video.play().catch(() => {});
}

/**
 * How far a picture in this page is from `rgb`: the largest difference, over the three channels, of its mean colour,
 * 0-255; 255 while there is no picture yet. `of` picks the picture: `agent`, what the test agent sees of the caller
 * (seeCallerVideoInPage); `camera`, WhatsApp Web's camera in the fake page, the stream its last video answer took (what
 * the caller sees).
 */
export function colourDistanceInPage(of: 'agent' | 'camera', rgb: number[]): number {
  const w = window as any;
  let v: HTMLVideoElement | undefined;
  if (of === 'agent') v = w.__agent?.video;
  else {
    const f = w.__fakeWa;
    const track: MediaStreamTrack | undefined = f.camStream?.getVideoTracks()[0];
    if (!track) return 255;
    // Each video answer takes a new camera stream: a page that takes several calls is looked at on the current one.
    if (f.camView?.track !== track) {
      const view = document.createElement('video');
      view.muted = true;
      view.srcObject = new MediaStream([track]);
      view.play().catch(() => {});
      f.camView = { track, view };
    }
    v = f.camView.view;
  }
  if (!v || v.readyState < 2 || !v.videoWidth) return 255;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 12;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(v, 0, 0, 16, 12);
  const d = g.getImageData(0, 0, 16, 12).data;
  const mean = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) mean[k] += d[i + k] / (d.length / 4);
  return Math.max(...mean.map((m, k) => Math.abs(m - rgb[k])));
}

// Node side, around the page function above: page functions cannot share code, a page gets each one as its own source.
/** In the test agent's page: how far what it sees of the caller is from `rgb` (colourDistanceInPage). */
export const agentSeesInPage = (agentPage: any, rgb: number[]): Promise<number> => agentPage.evaluate(colourDistanceInPage, 'agent', rgb);
/** In the fake WhatsApp Web page: how far its camera, what the caller sees, is from `rgb` (colourDistanceInPage). */
export const cameraCarriesInPage = (waPage: any, rgb: number[]): Promise<number> => waPage.evaluate(colourDistanceInPage, 'camera', rgb);

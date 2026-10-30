// whatsapp-web.js call media, without a browser: the adapter wiring (switch off = unchanged; on = hooks, flags,
// setup on EVERY ready) and the Node wrapper's arguments, guards and binding. The browser spec covers the page
// functions, and the wrapper against a real page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import {
  CALL_MEDIA_CHROME_ARGS,
  CALL_MEDIA_INIT_SCRIPT,
  WebJsCallMedia,
  WhatsAppWebJsAdapter,
  callMediaBridge,
  callMediaPage,
  mediasoupClientBundle,
  runCallMediaSignal,
} from '@multiwa/engines';
import type { CallMediaSignaling, EngineConfig } from '@multiwa/engines';

const { prepareCallMediaPage, answerActiveCall, hangUpActiveCall, playAnnouncementInPage, startRecordingInPage, stopRecordingInPage } = callMediaPage;
const { startBridgeInPage, attachCallerInPage, connectAgentInPage, closeBridgeInPage } = callMediaBridge;

/** The launch args of the adapter before call media existed. */
const DEFAULT_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--disable-gpu',
  ...(process.platform === 'linux' ? ['--disable-setuid-sandbox', '--no-zygote'] : []),
];

/** What the page functions answer, looked up by function identity: puppeteer would run them inside the page. */
const pageResults = new Map<unknown, unknown>([
  [prepareCallMediaPage, { hooks: true, micPermission: 'granted' }],
  [answerActiveCall, { connectedAfterMs: 120 }],
  [playAnnouncementInPage, { durationMs: 900 }],
  [startRecordingInPage, { callerVia: 'destination', freshCandidates: 1, fallback: false }],
  [stopRecordingInPage, { durationMs: 1000 }],
]);
/** A puppeteer Page that runs nothing. */
const fakePage = () => ({
  evaluate: vi.fn(async (fn: unknown, ..._args: unknown[]) => pageResults.get(fn)),
  exposeFunction: vi.fn(async (_name: string, _fn: unknown) => undefined),
  keyboard: { press: vi.fn(async (_key: string) => undefined) },
});
type FakePage = ReturnType<typeof fakePage>;

const b64 = (s: string) => Buffer.from(s).toString('base64');
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('call media launch pieces', () => {
  it('the init script is the hook installer called once, as a plain script', () => {
    expect(CALL_MEDIA_INIT_SCRIPT.startsWith('(function installCallMediaHooks(')).toBe(true);
    expect(CALL_MEDIA_INIT_SCRIPT.endsWith(')();')).toBe(true);
    // a downlevel helper or a module reference would not exist in the page
    expect(CALL_MEDIA_INIT_SCRIPT).not.toMatch(/__awaiter|__assign|__rest|require\(|exports\./);
    expect(() => new Script(CALL_MEDIA_INIT_SCRIPT)).not.toThrow(); // compiled only, never run
  });

  // The same check for every bridge function, which puppeteer sends as source text. `w.require(...)` is WhatsApp Web's own
  // module loader inside the page; only a bare `require(` would be a module reference.
  it.each(Object.entries(callMediaBridge))('the bridge page function %s is self-contained: no downlevel helper, no module reference', (_name, fn) => {
    const src = fn.toString();
    expect(src).not.toMatch(/__awaiter|__assign|__rest|(?<![.\w])require\(|exports\./);
    expect(() => new Script(`(${src})`)).not.toThrow(); // compiled only, never run
  });

  it('the Chrome flags give fake devices, an accepted media prompt and no sound', () => {
    expect(CALL_MEDIA_CHROME_ARGS).toEqual(
      expect.arrayContaining(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio']),
    );
  });

  it('the mediasoup-client page bundle is built next to the module: one script that defines mediasoupClient, with its licenses', () => {
    const src = mediasoupClientBundle();
    expect(src.startsWith('"use strict";var mediasoupClient=')).toBe(true);
    expect(src).toContain('3.25.3'); // the pinned version (mediasoupClient.version)
    expect(() => new Script(src)).not.toThrow(); // compile only, never run in Node
    // The licenses of everything bundled ship next to it, and the bundle points there.
    const dist = path.dirname(createRequire(__filename).resolve('@multiwa/engines'));
    const licenses = readFileSync(path.join(dist, 'adapters/webjs-call-media/mediasoup-client.iife.js.LICENSE.txt'), 'utf8');
    expect(src.trimEnd().endsWith('/*! mediasoup-client 3.25.3 and its dependencies: licenses in mediasoup-client.iife.js.LICENSE.txt */')).toBe(true);
    expect(licenses).toContain('=== mediasoup-client 3.25.3 (LICENSE) ===');
    expect(licenses).toContain('Permission to use, copy, modify'); // the ISC text itself
    expect(licenses).toMatch(/^=== debug \S+ \(LICENSE\) ===$/m); // and a dependency's
  });
});

describe('call media in the whatsapp-web.js adapter', () => {
  let sessionBase: string;

  /** The REAL initialize(): `new Client` only merges options and sets up LocalAuth; the browser starts in client.initialize(), which this never calls. */
  const initAdapter = async (extra: Partial<EngineConfig> = {}) => {
    const config: EngineConfig = { profileId: 'p1', sessionDir: path.join(sessionBase, 'p1'), onReady: vi.fn(), ...extra };
    const adapter = new WhatsAppWebJsAdapter() as any;
    await adapter.initialize(config);
    expect(readdirSync(sessionBase)).toEqual([]); // no browser started, no session files created
    return { adapter, client: adapter.client, config };
  };

  beforeEach(() => {
    sessionBase = mkdtempSync(path.join(tmpdir(), 'multiwa-call-media-'));
  });

  afterEach(() => {
    rmSync(sessionBase, { recursive: true, force: true });
  });

  it.each([
    ['switched off', { callMedia: { enabled: false } }],
    ['not configured', {}],
  ])('%s: the client launches exactly as before, and a ready leaves the page alone', async (_name, extra) => {
    const on = await initAdapter({ callMedia: { enabled: true } });
    const off = await initAdapter(extra);
    expect(off.client.options.evalOnNewDoc).toBeUndefined();
    expect(off.client.options.puppeteer.args).toEqual(DEFAULT_ARGS);
    expect(off.adapter.callMedia).toBeUndefined();
    expect(off.client.listenerCount('ready')).toBe(on.client.listenerCount('ready') - 1);
    const page = fakePage();
    off.client.pupPage = page;
    off.client.emit('ready');
    await tick();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.keyboard.press).not.toHaveBeenCalled();
    expect(page.exposeFunction).not.toHaveBeenCalled();
  });

  it('switched off, custom puppeteer args are used as they are', async () => {
    const { client } = await initAdapter({ callMedia: { enabled: false }, puppeteerOptions: { args: ['--custom'] } });
    expect(client.options.puppeteer.args).toEqual(['--custom']);
  });

  it('switched on: the hooks go on every document, the flags on the browser, and the adapter holds a wrapper', async () => {
    const { adapter, client } = await initAdapter({ callMedia: { enabled: true } });
    expect(client.options.evalOnNewDoc).toBe(CALL_MEDIA_INIT_SCRIPT); // the very string the specs check and inject
    expect(client.options.puppeteer.args).toEqual([...DEFAULT_ARGS, ...CALL_MEDIA_CHROME_ARGS]);
    expect(adapter.callMedia).toBeInstanceOf(WebJsCallMedia);
  });

  it('switched on with custom puppeteer args: the flags are added to theirs', async () => {
    const { client } = await initAdapter({ callMedia: { enabled: true }, puppeteerOptions: { args: ['--custom'] } });
    expect(client.options.puppeteer.args).toEqual(['--custom', ...CALL_MEDIA_CHROME_ARGS]);
  });

  it('prepares the page on EVERY ready, once per page object, while onReady fires once', async () => {
    const { client, config } = await initAdapter({ callMedia: { enabled: true } });
    const page = fakePage();
    client.pupPage = page;
    client.emit('ready');
    client.emit('ready'); // whatsapp-web.js repeats ready 5-12 times per sync, and WA Web may reload its page
    await vi.waitFor(() => expect(page.keyboard.press).toHaveBeenCalledTimes(2));
    expect(page.keyboard.press).toHaveBeenCalledWith('Shift');
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.evaluate).toHaveBeenCalledWith(prepareCallMediaPage);
    expect(page.exposeFunction).toHaveBeenCalledTimes(1);
    expect(config.onReady).toHaveBeenCalledTimes(1);
    const relaunched = fakePage(); // the engine relaunched: a new page object needs its own binding
    client.pupPage = relaunched;
    client.emit('ready');
    await vi.waitFor(() => expect(relaunched.keyboard.press).toHaveBeenCalledTimes(1));
    expect(relaunched.exposeFunction).toHaveBeenCalledTimes(1);
    expect(config.onReady).toHaveBeenCalledTimes(1);
  });

  it('a failing page setup logs one sanitized warning and throws nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { client, config } = await initAdapter({ callMedia: { enabled: true } });
      config.profileId = 'p\n1'; // the line must stay one line whatever the id holds
      const page = fakePage();
      page.evaluate.mockRejectedValue(new Error('Execution context was\ndestroyed'));
      client.pupPage = page;
      expect(() => client.emit('ready')).not.toThrow();
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      await tick(); // an unhandled rejection surfaces a tick later
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('call media setup failed for profile p1: Execution context wasdestroyed');
      expect(line).not.toMatch(/[\r\n]/);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('a second initialize() cannot move the first wrapper onto the second client: the first ready leaves the second page alone', async () => {
    const { adapter, client: first, config } = await initAdapter({ callMedia: { enabled: true } });
    await adapter.initialize(config); // not done in production (one adapter per engine), but nothing forbids it
    const second = adapter.client;
    expect(second).not.toBe(first);
    const secondPage = fakePage();
    first.pupPage = fakePage();
    second.pupPage = secondPage;
    first.emit('ready');
    await tick();
    expect(secondPage.exposeFunction).not.toHaveBeenCalled();
    expect(secondPage.keyboard.press).not.toHaveBeenCalled();
    expect(secondPage.evaluate).not.toHaveBeenCalled();
  });

  it('after destroy() the wrapper has no page, although whatsapp-web.js leaves client.pupPage set', async () => {
    const { adapter, client } = await initAdapter({ callMedia: { enabled: true } });
    const page = fakePage();
    client.pupPage = page;
    client.emit('ready'); // the adapter reads ready now
    await vi.waitFor(() => expect(page.evaluate).toHaveBeenCalledTimes(1));
    const media: WebJsCallMedia = adapter.callMedia;
    await adapter.destroy(); // whatsapp-web.js destroy() closes the browser and does not clear client.pupPage
    expect(client.pupPage).toBe(page);
    const touches = () => page.evaluate.mock.calls.length + page.exposeFunction.mock.calls.length + page.keyboard.press.mock.calls.length;
    const before = touches();
    await media.preparePage(); // a no-op, not a failed attempt on a closed page
    await expect(media.stopRecording('c1')).rejects.toThrow('Client not ready');
    await expect(media.startRecording('c1', () => undefined)).rejects.toThrow('Client not ready');
    await expect(media.answer('c1')).rejects.toThrow('Client not ready');
    expect(await media.getSupport()).toEqual({ supported: false, reasons: ['not_ready'] });
    expect(touches()).toBe(before);
  });
});

describe('WebJsCallMedia without a browser', () => {
  it('getSupport reads not_ready with no page or while not ready, and leaves the page alone', async () => {
    const page = fakePage();
    expect(await new WebJsCallMedia(() => null, () => true, 'p1').getSupport()).toEqual({ supported: false, reasons: ['not_ready'] });
    expect(await new WebJsCallMedia(() => page, () => false, 'p1').getSupport()).toEqual({ supported: false, reasons: ['not_ready'] });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('hands the page the call id and the deadline, and returns what the page answers', async () => {
    const page = fakePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    expect(await media.answer('c1')).toEqual({ connectedAfterMs: 120 });
    expect(page.evaluate).toHaveBeenLastCalledWith(answerActiveCall, 'c1', 15000);
    await media.answer('c1', { timeoutMs: 3000 });
    expect(page.evaluate).toHaveBeenLastCalledWith(answerActiveCall, 'c1', 3000);
    await media.hangUp('c1');
    expect(page.evaluate).toHaveBeenLastCalledWith(hangUpActiveCall, 'c1', 10000);
    expect(await media.playAnnouncement('c1', Buffer.from([1, 2, 3]))).toEqual({ durationMs: 900 });
    expect(page.evaluate).toHaveBeenLastCalledWith(playAnnouncementInPage, 'c1', 'AQID'); // the audio as base64
  });

  it('a page rejection surfaces unchanged', async () => {
    const page = fakePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    for (const call of [() => media.answer('c1'), () => media.hangUp('c1'), () => media.playAnnouncement('c1', Buffer.alloc(1))]) {
      const refused = new Error('Call is not the active call');
      page.evaluate.mockRejectedValueOnce(refused);
      await expect(call()).rejects.toBe(refused);
    }
  });

  it.each([
    ['the client is not ready', (page: FakePage) => new WebJsCallMedia(() => page, () => false, 'p1')],
    ['there is no page', () => new WebJsCallMedia(() => null, () => true, 'p1')],
  ])('answer, hangUp, playAnnouncement and startRecording refuse with "Client not ready" when %s', async (_when, make) => {
    const page = fakePage();
    const media = make(page);
    await expect(media.answer('c1')).rejects.toThrow('Client not ready');
    await expect(media.hangUp('c1')).rejects.toThrow('Client not ready');
    await expect(media.playAnnouncement('c1', Buffer.alloc(1))).rejects.toThrow('Client not ready');
    await expect(media.startRecording('c1', () => undefined)).rejects.toThrow('Client not ready');
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.exposeFunction).not.toHaveBeenCalled();
  });

  it('a start refused for readiness takes no recording slot', async () => {
    let ready = false;
    const media = new WebJsCallMedia(() => fakePage(), () => ready, 'p1');
    await expect(media.startRecording('c1', () => undefined)).rejects.toThrow('Client not ready');
    ready = true;
    await media.startRecording('c1', () => undefined); // not "Already recording"
  });

  it('hands a recording chunk to the recording of its call only, in order, as Buffers', async () => {
    const page = fakePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const got: Buffer[] = [];
    await media.startRecording('c1', (chunk) => got.push(chunk));
    expect(page.exposeFunction).toHaveBeenCalledWith('__mwRecordingChunk', expect.any(Function));
    const binding = page.exposeFunction.mock.calls[0][1] as (callId: string, chunk: string) => void;
    binding('c1', b64('one'));
    binding('c1', b64('two'));
    expect(got).toEqual([Buffer.from('one'), Buffer.from('two')]);
    expect(() => binding('c2', b64('other'))).toThrow('Not recording this call');
    expect(got).toHaveLength(2);
    await media.stopRecording('c1');
    expect(() => binding('c1', b64('late'))).toThrow('No recording in progress');
    expect(got).toHaveLength(2);
  });

  it('a recording binding error reaches the page as a fresh Error whose stack is its message, so no server path leaks', async () => {
    const page = fakePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    await media.startRecording('c1', () => { throw new Error('sink down'); });
    const binding = page.exposeFunction.mock.calls[0][1] as (callId: string, chunk: string) => void;
    const errors: Error[] = [];
    for (const chunk of [() => binding('c2', b64('x')), () => binding('c1', b64('x'))]) {
      try {
        chunk();
      } catch (e) {
        errors.push(e as Error);
      }
    }
    expect(errors.map((e) => e.message)).toEqual(['Not recording this call', 'sink down']);
    for (const e of errors) expect(e.stack).toBe(e.message);
  });

  it('two callers on one page object bind once', async () => {
    const page = fakePage();
    let release!: () => void;
    page.exposeFunction.mockImplementation(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const setup = media.preparePage();
    const start = media.startRecording('c1', () => undefined);
    release();
    await Promise.all([setup, start]);
    expect(page.exposeFunction).toHaveBeenCalledTimes(1);
  });

  it('forgets a binding that failed: the start frees its slot and the next call binds again', async () => {
    const page = fakePage();
    page.exposeFunction.mockRejectedValueOnce(new Error('Protocol error: Target closed'));
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    await expect(media.startRecording('c1', () => undefined)).rejects.toThrow('Target closed');
    await media.startRecording('c1', () => undefined); // not "Already recording"
    expect(page.exposeFunction).toHaveBeenCalledTimes(2);
  });

  it('a failing binding does not stop preparePage: Shift is pressed and the page is prepared', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const page = fakePage();
    page.exposeFunction.mockRejectedValueOnce(new Error('Protocol error: Target closed'));
    await new WebJsCallMedia(() => page, () => true, 'p1').preparePage();
    expect(page.keyboard.press).toHaveBeenCalledWith('Shift');
    expect(page.evaluate).toHaveBeenCalledWith(prepareCallMediaPage);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('recording binding');
  });

  describe('the page setup warning', () => {
    const NO_HOOKS = { hooks: false, micPermission: 'no hooks' };
    const MIC_FAILED = { hooks: true, micPermission: 'failed: NotAllowedError: Permission denied' };
    const GOOD = { hooks: true, micPermission: 'granted' };

    /** Runs preparePage once per result, the page answering each in turn; returns the warnings logged. */
    const warningsFor = async (results: object[], profileId = 'p1') => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      warn.mockClear(); // a test may call this twice: start from no calls
      const page = fakePage();
      for (const r of results) page.evaluate.mockResolvedValueOnce(r);
      const media = new WebJsCallMedia(() => page, () => true, profileId);
      for (const _r of results) await media.preparePage();
      return warn.mock.calls.map((c) => String(c[0]));
    };

    it('a page without the hooks warns once, however many readys follow', async () => {
      expect(await warningsFor([NO_HOOKS, NO_HOOKS, NO_HOOKS, NO_HOOKS, NO_HOOKS])).toEqual([
        '[WhatsApp-WebJS] call media page setup for profile p1: {"hooks":false,"micPermission":"no hooks"}',
      ]);
    });

    it('a different bad result warns again', async () => {
      const lines = await warningsFor([NO_HOOKS, NO_HOOKS, MIC_FAILED, MIC_FAILED]);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('"hooks":false');
      expect(lines[1]).toContain('failed: NotAllowedError: Permission denied');
    });

    it('a good setup in between re-arms the warning', async () => {
      const lines = await warningsFor([NO_HOOKS, GOOD, NO_HOOKS, { hooks: true, micPermission: 'already granted' }, NO_HOOKS, NO_HOOKS]);
      expect(lines).toHaveLength(3);
      expect(new Set(lines).size).toBe(1); // the same text, three times: each after a good setup
    });

    it('a failed mic permission warns, a granted one never does', async () => {
      expect(await warningsFor([MIC_FAILED])).toEqual([
        '[WhatsApp-WebJS] call media page setup for profile p1: {"hooks":true,"micPermission":"failed: NotAllowedError: Permission denied"}',
      ]);
      expect(await warningsFor([GOOD, { hooks: true, micPermission: 'already granted' }])).toEqual([]);
    });

    it('stays one line whatever the page or the profile id holds', async () => {
      const lines = await warningsFor([{ hooks: true, micPermission: 'failed: a\nb\r\nc' }], 'p\n1');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('call media page setup for profile p1: ');
      expect(lines[0]).not.toMatch(/[\r\n]/);
    });
  });

  it('every log line keeps the profile id on one line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.mocked(console.log); // spied by the beforeEach above
    const page = fakePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p\n1');
    page.exposeFunction.mockRejectedValueOnce(new Error('Protocol error: Target closed'));
    page.evaluate.mockResolvedValueOnce({ hooks: false, micPermission: 'no hooks' });
    await media.preparePage(); // the binding warning and the setup warning
    page.evaluate.mockRejectedValueOnce(new Error('boom'));
    await media.getSupport(); // the probe warning
    await media.answer('c1'); // the answered line
    page.evaluate.mockResolvedValueOnce({ callerVia: 'destination', freshCandidates: 2, fallback: false });
    await media.startRecording('c1', () => undefined); // the guessed-tap warning
    const lines = [...warn.mock.calls, ...log.mock.calls].map((c) => String(c[0]));
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line).toContain('profile p1');
      expect(line).not.toMatch(/[\r\n]/);
    }
  });
});

describe('WebJsCallMedia media bridge, without a browser', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const fakeSignaling = () => ({
    rtpCapabilities: vi.fn(async () => ({ codecs: [] })),
    createTransport: vi.fn(async (direction: string) => ({ id: `T-${direction}` })),
    connectTransport: vi.fn(async () => undefined),
    produce: vi.fn(async () => ({ id: 'P-caller' })),
    consume: vi.fn(async () => ({ id: 'C-agent' })),
    resumeConsumer: vi.fn(async () => undefined),
    closeConsumer: vi.fn(async () => undefined),
  });
  /**
   * A page that records what the wrapper evaluates. `signal` calls the binding the wrapper exposed (`raw` with a ready
   * string); `holdNext` and `failNext` act on the NEXT evaluate of one page function (an evaluate that already started
   * is not touched).
   */
  const bridgePage = (opts: { startFails?: boolean } = {}) => {
    let binding: ((callId: string, op: string, json: string) => Promise<string>) | null = null;
    const held = new Map<unknown, Promise<void>>();
    const failing = new Map<unknown, Error>();
    const page: any = {
      loaded: false,
      exposeFunction: vi.fn(async (name: string, fn: any) => { if (name === '__mwBridgeSignal') binding = fn; }),
      evaluate: vi.fn(async (fn: any, ...args: any[]) => {
        const hold = held.get(fn);
        const failure = failing.get(fn);
        held.delete(fn);
        failing.delete(fn);
        await hold;
        if (failure) throw failure;
        if (typeof fn === 'string') { page.loaded = true; return undefined; } // the mediasoup-client bundle
        if (fn === callMediaBridge.hasMediasoupClient) return page.loaded;
        if (fn === callMediaBridge.startBridgeInPage) {
          if (opts.startFails) throw new Error('Call is not the active call');
          return { callerProducerId: 'P-caller' };
        }
        if (fn === callMediaBridge.closeBridgeInPage) return { closed: true };
        return { fn: fn.name, args };
      }),
      signal: (callId: string, op: string, a: unknown) => binding!(callId, op, JSON.stringify(a)),
      raw: (callId: string, op: string, json: string) => binding!(callId, op, json),
      holdNext: (fn: unknown) => {
        let release!: () => void;
        held.set(fn, new Promise<void>((resolve) => { release = resolve; }));
        return release;
      },
      failNext: (fn: unknown, error: Error) => { failing.set(fn, error); },
      /** The page functions the wrapper sent so far, by name ("bundle" for the mediasoup-client script). */
      sent: () => page.evaluate.mock.calls.map(([fn]: any[]) => (typeof fn === 'string' ? 'bundle' : fn.name)),
    };
    return page;
  };

  it('starts the bridge: one binding, the bundle only when missing, then the page start; the handle drives the page', async () => {
    const page = bridgePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const handle = await media.startCallMedia('c1', fakeSignaling());
    expect(handle.callerProducerId).toBe('P-caller');
    expect(page.exposeFunction).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls.filter(([fn]: any[]) => typeof fn === 'string')).toHaveLength(1);
    expect(page.evaluate).toHaveBeenCalledWith(callMediaBridge.startBridgeInPage, 'c1');
    expect(await handle.attachCaller()).toEqual({ fn: 'attachCallerInPage', args: ['c1'] });
    expect(await handle.connectAgent('P-agent')).toEqual({ fn: 'connectAgentInPage', args: ['c1', 'P-agent'] });
    expect(await handle.disconnectAgent()).toEqual({ fn: 'disconnectAgentInPage', args: ['c1'] });
    await handle.close();
    expect(page.evaluate).toHaveBeenCalledWith(callMediaBridge.closeBridgeInPage, 'c1');
    // a second call on the same page: no second binding, no second bundle
    await (await media.startCallMedia('c2', fakeSignaling())).close();
    expect(page.exposeFunction).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls.filter(([fn]: any[]) => typeof fn === 'string')).toHaveLength(1);
  });

  it('refuses to start when WhatsApp is not ready, and touches nothing', async () => {
    const page = bridgePage();
    await expect(new WebJsCallMedia(() => page, () => false, 'p1').startCallMedia('c1', fakeSignaling())).rejects.toThrow('Client not ready');
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('one bridge at a time: a second start is refused until the first one closes', async () => {
    const media = new WebJsCallMedia(() => bridgePage(), () => true, 'p1');
    const first = await media.startCallMedia('c1', fakeSignaling());
    await expect(media.startCallMedia('c2', fakeSignaling())).rejects.toThrow('Media bridge already running');
    await first.close();
    await expect(media.startCallMedia('c2', fakeSignaling())).resolves.toBeDefined();
  });

  it('a start that fails frees the slot and closes what the page may have started', async () => {
    const page = bridgePage({ startFails: true });
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    await expect(media.startCallMedia('c1', fakeSignaling())).rejects.toThrow('Call is not the active call');
    expect(page.evaluate).toHaveBeenCalledWith(callMediaBridge.closeBridgeInPage, 'c1');
    page.evaluate.mockImplementation(async (fn: any) => (fn === callMediaBridge.startBridgeInPage ? { callerProducerId: 'P2' } : true));
    await expect(media.startCallMedia('c1', fakeSignaling())).resolves.toMatchObject({ callerProducerId: 'P2' });
  });

  it('the page binding runs the room signalling of the CURRENT call only, as JSON both ways', async () => {
    const page = bridgePage();
    const s = fakeSignaling();
    const handle = await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', s);
    expect(JSON.parse(await page.signal('c1', 'createTransport', { direction: 'recv' }))).toEqual({ id: 'T-recv' });
    expect(s.createTransport).toHaveBeenCalledWith('recv');
    expect(await page.signal('c1', 'connectTransport', { transportId: 'T-send', dtlsParameters: { role: 'client' } })).toBe('null');
    expect(s.connectTransport).toHaveBeenCalledWith('T-send', { role: 'client' });
    await expect(page.signal('c2', 'rtpCapabilities', {})).rejects.toThrow('No media bridge for this call');
    await expect(page.signal('c1', 'deleteEverything', {})).rejects.toThrow('Unknown media signalling operation');
    await handle.close();
    await expect(page.signal('c1', 'rtpCapabilities', {})).rejects.toThrow('No media bridge for this call');
  });

  it('runCallMediaSignal maps every operation of the protocol onto the signalling', async () => {
    const s = fakeSignaling() as unknown as CallMediaSignaling;
    await runCallMediaSignal(s, 'rtpCapabilities', {});
    await runCallMediaSignal(s, 'produce', { transportId: 'T', kind: 'audio', rtpParameters: { codecs: [] } });
    await runCallMediaSignal(s, 'consume', { transportId: 'T', producerId: 'P', rtpCapabilities: { codecs: [] } });
    await runCallMediaSignal(s, 'resumeConsumer', { consumerId: 'C' });
    await runCallMediaSignal(s, 'closeConsumer', { consumerId: 'C' });
    expect((s as any).produce).toHaveBeenCalledWith('T', 'audio', { codecs: [] });
    expect((s as any).consume).toHaveBeenCalledWith('T', 'P', { codecs: [] });
    expect((s as any).resumeConsumer).toHaveBeenCalledWith('C');
    expect((s as any).closeConsumer).toHaveBeenCalledWith('C');
    await expect(runCallMediaSignal(s, 'nope', {})).rejects.toThrow('Unknown media signalling operation');
  });

  it('two starts in the same tick: the second is refused, the first resolves untouched', async () => {
    const page = bridgePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const first = media.startCallMedia('c1', fakeSignaling());
    const second = media.startCallMedia('c2', fakeSignaling()); // no await in between: the slot is taken before the first await
    await expect(second).rejects.toThrow('Media bridge already running');
    await expect(first).resolves.toMatchObject({ callerProducerId: 'P-caller' });
    expect(page.sent()).not.toContain('closeBridgeInPage'); // the refused start did not close the running one
    await expect(media.startCallMedia('c3', fakeSignaling())).rejects.toThrow('Media bridge already running'); // the first still holds the slot
  });

  it('close() frees the slot even when the page rejects, and surfaces that rejection', async () => {
    const page = bridgePage();
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const handle = await media.startCallMedia('c1', fakeSignaling());
    page.failNext(closeBridgeInPage, new Error('Protocol error: Target closed'));
    await expect(handle.close()).rejects.toThrow('Target closed'); // the coordinator learns it, and closes the room regardless
    await expect(media.startCallMedia('c2', fakeSignaling())).resolves.toBeDefined(); // not "Media bridge already running"
  });

  it('a binding attempt that failed with anything but "already exists" is forgotten: the next start binds again', async () => {
    const page = bridgePage();
    page.exposeFunction.mockRejectedValueOnce(new Error('Protocol error: Target closed'));
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    await expect(media.startCallMedia('c1', fakeSignaling())).rejects.toThrow('Target closed');
    await expect(media.startCallMedia('c1', fakeSignaling())).resolves.toBeDefined(); // the slot was freed, and the failure not remembered
    expect(page.exposeFunction).toHaveBeenCalledTimes(2);
  });

  it('"already exists" from exposeFunction counts as bound: puppeteer holds our binding, and the start goes on', async () => {
    const page = bridgePage();
    page.exposeFunction.mockRejectedValueOnce(new Error("Failed to add page binding with name __mwBridgeSignal: window['__mwBridgeSignal'] already exists!"));
    const media = new WebJsCallMedia(() => page, () => true, 'p1');
    const handle = await media.startCallMedia('c1', fakeSignaling());
    await handle.close();
    await (await media.startCallMedia('c1', fakeSignaling())).close();
    expect(page.exposeFunction).toHaveBeenCalledTimes(1); // bound for good on this page object
  });

  describe('a handle or a start that was let go of', () => {
    it('a stale handle cannot drive or close a newer bridge of the same call', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      const stale = await media.startCallMedia('c1', fakeSignaling());
      await stale.close();
      const current = await media.startCallMedia('c1', fakeSignaling());
      page.evaluate.mockClear();
      await expect(stale.attachCaller()).rejects.toThrow('Media bridge closed');
      await expect(stale.connectAgent('P-agent')).rejects.toThrow('Media bridge closed');
      await expect(stale.disconnectAgent()).rejects.toThrow('Media bridge closed');
      await stale.close(); // a no-op
      expect(page.evaluate).not.toHaveBeenCalled(); // the newer bridge was not touched in the page
      await expect(media.startCallMedia('c1', fakeSignaling())).rejects.toThrow('Media bridge already running'); // and still holds the slot
      expect(await current.attachCaller()).toEqual({ fn: 'attachCallerInPage', args: ['c1'] });
      await current.close();
    });

    it('a close() still waiting on the page does not free the slot of a newer bridge', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      const old = await media.startCallMedia('c1', fakeSignaling());
      const release = page.holdNext(closeBridgeInPage);
      const closing = old.close(); // waits for the page
      await media.closeCallMedia('c1'); // the coordinator frees the slot meanwhile...
      await media.startCallMedia('c1', fakeSignaling()); // ...and the call starts again
      release();
      await closing;
      await expect(media.startCallMedia('c1', fakeSignaling())).rejects.toThrow('Media bridge already running');
    });

    it('a failed start frees the slot only while it is still its own, and leaves a newer bridge in the page alone', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      const release = page.holdNext(startBridgeInPage);
      page.failNext(startBridgeInPage, new Error('Call is not the active call'));
      const first = media.startCallMedia('c1', fakeSignaling()).then(() => 'resolved', (e: Error) => e.message);
      await vi.waitFor(() => expect(page.sent()).toContain('startBridgeInPage'));
      await media.closeCallMedia('c1'); // the coordinator gave up on the first start...
      const retry = await media.startCallMedia('c1', fakeSignaling()); // ...and starts again, on a new room
      page.evaluate.mockClear();
      release(); // now the first start fails in the page
      expect(await first).toBe('Call is not the active call');
      expect(page.evaluate).not.toHaveBeenCalled(); // it did not close the retry's bridge in the page...
      await expect(media.startCallMedia('c1', fakeSignaling())).rejects.toThrow('Media bridge already running'); // ...nor free its slot
      expect(await retry.disconnectAgent()).toEqual({ fn: 'disconnectAgentInPage', args: ['c1'] });
    });
  });

  describe('closeCallMedia', () => {
    it('frees the slot of its call and closes that call\'s bridge in the page, with no handle', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      await media.startCallMedia('c1', fakeSignaling()); // the handle is gone: the coordinator never got it
      await media.closeCallMedia('c1');
      expect(page.evaluate).toHaveBeenLastCalledWith(closeBridgeInPage, 'c1');
      await expect(media.startCallMedia('c2', fakeSignaling())).resolves.toBeDefined();
    });

    it('leaves the slot of another call alone, and asks the page to close the call it was given', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      await media.startCallMedia('c1', fakeSignaling());
      await media.closeCallMedia('c2');
      expect(page.evaluate).toHaveBeenLastCalledWith(closeBridgeInPage, 'c2');
      await expect(media.startCallMedia('c3', fakeSignaling())).rejects.toThrow('Media bridge already running');
      await media.closeCallMedia('c1');
      await media.closeCallMedia('c1'); // idempotent
      await expect(media.startCallMedia('c3', fakeSignaling())).resolves.toBeDefined();
    });

    it('never rejects: a failing page, no page, and a page getter that throws all read as done', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      await media.startCallMedia('c1', fakeSignaling());
      page.failNext(closeBridgeInPage, new Error('Protocol error: Target closed'));
      await expect(media.closeCallMedia('c1')).resolves.toBeUndefined();
      await expect(media.startCallMedia('c2', fakeSignaling())).resolves.toBeDefined(); // the slot was freed all the same
      await expect(new WebJsCallMedia(() => null, () => true, 'p1').closeCallMedia('c1')).resolves.toBeUndefined();
      const broken = new WebJsCallMedia(() => { throw new Error('browser gone'); }, () => true, 'p1');
      await expect(broken.closeCallMedia('c1')).resolves.toBeUndefined();
    });

    it('needs no WhatsApp readiness: after a disconnect the page can still hold the bridge', async () => {
      let ready = true;
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => ready, 'p1');
      await media.startCallMedia('c1', fakeSignaling());
      ready = false;
      await media.closeCallMedia('c1');
      expect(page.evaluate).toHaveBeenLastCalledWith(closeBridgeInPage, 'c1');
      ready = true;
      await expect(media.startCallMedia('c2', fakeSignaling())).resolves.toBeDefined();
    });

    it('a start the coordinator stopped waiting for: its slot is free at once, and the late start closes its page bridge and rejects', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      const release = page.holdNext(startBridgeInPage);
      const abandoned = media.startCallMedia('c1', fakeSignaling()).then(() => 'resolved', (e: Error) => e.message);
      await vi.waitFor(() => expect(page.sent()).toContain('startBridgeInPage'));
      await media.closeCallMedia('c1'); // the coordinator's deadline fired
      await media.startCallMedia('c2', fakeSignaling()); // the slot is free at once: the next call is not blocked
      page.evaluate.mockClear();
      release(); // the abandoned start resolves in the page after all
      expect(await abandoned).toBe('Media bridge closed');
      expect(page.evaluate).toHaveBeenCalledWith(closeBridgeInPage, 'c1'); // nothing of it stays in the page
      await expect(media.startCallMedia('c3', fakeSignaling())).rejects.toThrow('Media bridge already running'); // c2's slot is intact
    });
  });

  describe("the handle's operations", () => {
    it('run one at a time, in call order: a disconnect issued while a connect is pending runs after it', async () => {
      const page = bridgePage();
      const handle = await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', fakeSignaling());
      const release = page.holdNext(connectAgentInPage);
      page.evaluate.mockClear();
      const connecting = handle.connectAgent('P-agent');
      const disconnecting = handle.disconnectAgent();
      await tick();
      await tick();
      expect(page.sent()).toEqual(['connectAgentInPage']); // the disconnect waits: it would find no agent yet
      release();
      await connecting;
      await disconnecting;
      expect(page.sent()).toEqual(['connectAgentInPage', 'disconnectAgentInPage']);
    });

    it('attach, connect and disconnect issued together run in that order', async () => {
      const page = bridgePage();
      const handle = await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', fakeSignaling());
      const release = page.holdNext(attachCallerInPage);
      page.evaluate.mockClear();
      const all = Promise.all([handle.attachCaller(), handle.connectAgent('P-agent'), handle.disconnectAgent()]);
      await tick();
      expect(page.sent()).toEqual(['attachCallerInPage']);
      release();
      await all;
      expect(page.sent()).toEqual(['attachCallerInPage', 'connectAgentInPage', 'disconnectAgentInPage']);
    });

    it('a failed operation does not break the chain: the next one runs, each caller sees its own outcome', async () => {
      const page = bridgePage();
      const handle = await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', fakeSignaling());
      page.failNext(connectAgentInPage, new Error('resumeConsumer refused'));
      const connecting = handle.connectAgent('P-agent');
      const disconnecting = handle.disconnectAgent();
      const attaching = handle.attachCaller();
      await expect(connecting).rejects.toThrow('resumeConsumer refused');
      await expect(disconnecting).resolves.toEqual({ fn: 'disconnectAgentInPage', args: ['c1'] });
      await expect(attaching).resolves.toEqual({ fn: 'attachCallerInPage', args: ['c1'] });
    });

    it('an operation queued behind another is refused when the bridge was closed meanwhile', async () => {
      const page = bridgePage();
      const handle = await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', fakeSignaling());
      const release = page.holdNext(connectAgentInPage);
      const connecting = handle.connectAgent('P-agent');
      const disconnecting = handle.disconnectAgent();
      disconnecting.catch(() => undefined);
      await handle.close();
      release();
      await connecting; // it was with the page already
      await expect(disconnecting).rejects.toThrow('Media bridge closed'); // checked when its turn came
      expect(page.sent()).not.toContain('disconnectAgentInPage');
    });

    it('close() and closeCallMedia() do not wait behind a hung operation', async () => {
      const page = bridgePage();
      const media = new WebJsCallMedia(() => page, () => true, 'p1');
      const handle = await media.startCallMedia('c1', fakeSignaling());
      page.holdNext(connectAgentInPage); // never released
      void handle.connectAgent('P-agent');
      await tick(); // the connect is with the page, and hangs there
      await handle.close(); // resolves although the connect hangs
      expect(page.evaluate).toHaveBeenLastCalledWith(closeBridgeInPage, 'c1');
      const second = await media.startCallMedia('c2', fakeSignaling());
      page.holdNext(attachCallerInPage); // never released
      void second.attachCaller();
      await tick();
      await media.closeCallMedia('c2');
      expect(page.evaluate).toHaveBeenLastCalledWith(closeBridgeInPage, 'c2');
    });
  });

  describe('what the page can send through the binding', () => {
    it('refuses a message over 64 KB before parsing it, and takes one of exactly 64 KB', async () => {
      const page = bridgePage();
      const s = fakeSignaling();
      await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', s);
      const largest = `"${'x'.repeat(64 * 1024 - 2)}"`; // valid JSON, 65536 characters
      expect(largest).toHaveLength(64 * 1024);
      expect(JSON.parse(await page.raw('c1', 'rtpCapabilities', largest))).toEqual({ codecs: [] });
      await expect(page.raw('c1', 'rtpCapabilities', `${largest} `)).rejects.toThrow('Media signalling message too large');
      await expect(page.raw('c1', 'rtpCapabilities', '{'.repeat(100_000))).rejects.toThrow('Media signalling message too large'); // not a SyntaxError
      expect(s.rtpCapabilities).toHaveBeenCalledTimes(1);
    });

    it('an error reaches the page as a fresh Error whose stack is its message, so no server path leaks', async () => {
      const page = bridgePage();
      await new WebJsCallMedia(() => page, () => true, 'p1').startCallMedia('c1', fakeSignaling());
      for (const failing of [() => page.signal('c1', 'deleteEverything', {}), () => page.signal('c2', 'rtpCapabilities', {}), () => page.raw('c1', 'rtpCapabilities', 'not json')]) {
        const error = await failing().then(() => null, (e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error!.message).not.toBe('');
        expect(error!.stack).toBe(error!.message);
      }
    });
  });
});

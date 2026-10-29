// whatsapp-web.js call media, without a browser: the adapter wiring (switch off = unchanged; on = hooks, flags,
// setup on EVERY ready) and the Node wrapper's arguments, guards and binding. The browser spec covers the page
// functions, and the wrapper against a real page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { CALL_MEDIA_CHROME_ARGS, CALL_MEDIA_INIT_SCRIPT, WebJsCallMedia, WhatsAppWebJsAdapter, callMediaPage } from '@multiwa/engines';
import type { EngineConfig } from '@multiwa/engines';

const { prepareCallMediaPage, answerActiveCall, hangUpActiveCall, playAnnouncementInPage, startRecordingInPage, stopRecordingInPage } = callMediaPage;

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

  it('the Chrome flags give fake devices, an accepted media prompt and no sound', () => {
    expect(CALL_MEDIA_CHROME_ARGS).toEqual(
      expect.arrayContaining(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio']),
    );
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

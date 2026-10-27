// whatsapp-web.js media-send patch guard.
//
// WhatsApp Web's MediaData is a model whose internal attributes are prefixed
// `__x_`. `Utils.js` builds the outgoing Msg by spreading that model directly,
// which copies `__x_id` onto the message; the send then throws
//
//     Data passed to getter must include an id property
//
// EVERY image, video and document send fails that way — and the API still
// answers 201, so nothing upstream notices. The rows land in `messages` as
// `failed` with no error recorded anywhere.
//
// The fix lives in patches/whatsapp-web.js@1.34.7.patch. What this guard checks
// is that the patch is APPLIED, not merely present: pnpm keys
// `patchedDependencies` to an exact version and stores the result under a
// directory whose name embeds a peer hash, so a dependency bump can silently
// drop a patch while the .patch file sits untouched in git. A test that only
// read the patch file would stay green through exactly that failure.
//
// See also patched-deps-pinned.spec.ts, which guards the version pinning.

import { readFileSync, existsSync, readdirSync } from 'fs';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PATCH_FILE = path.join(REPO_ROOT, 'patches', 'whatsapp-web.js@1.34.7.patch');

// The patch hash the lockfile pins: pnpm installs the package under a directory named after it.
const LOCKED_HASH = /whatsapp-web\.js@1\.34\.7\(patch_hash=([a-z0-9]+)\)/.exec(
  readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8'),
)?.[1];

/** An installed source file, found through pnpm's peer-hash directory name. */
function installedFile(relative: string[], marker: string): string | null {
  const pnpmDir = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const candidates = readdirSync(pnpmDir)
    .filter((d) => d.startsWith('whatsapp-web.js@1.34.7'))
    .map((d) => path.join(pnpmDir, d, 'node_modules', 'whatsapp-web.js', ...relative))
    .filter((p) => existsSync(p));
  // Stale hash dirs linger after a re-patch: the copy the lockfile pins is what counts. When it
  // is not installed the answer is null ("run pnpm install"), never a stale copy that happens to pass.
  if (LOCKED_HASH) return candidates.find((p) => p.includes(`patch_hash=${LOCKED_HASH}`)) ?? null;
  // Only when the lockfile hash cannot be parsed: the first copy that carries the marker.
  const patched = candidates.find((p) => readFileSync(p, 'utf8').includes(marker));
  return patched ?? candidates[0] ?? null;
}
const installedUtilsJs = () => installedFile(['src', 'util', 'Injected', 'Utils.js'], 'omitModelInternals');
const installedMessageJs = () => installedFile(['src', 'structures', 'Message.js'], 'forward the declared mimetype');

describe('whatsapp-web.js media patch', () => {
  it('reads the copy the lockfile pins', () => {
    expect(LOCKED_HASH, 'pnpm-lock.yaml no longer has whatsapp-web.js@1.34.7(patch_hash=…)').toBeDefined();
  });

  it('ships the patch file', () => {
    expect(existsSync(PATCH_FILE), `${PATCH_FILE} is missing`).toBe(true);
  });

  it('the patch strips __x_id from the outgoing message', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch, 'the media fix should be in the patch').toMatch(/omitModelInternals/);
    expect(patch, 'it is __x_id specifically that breaks the getter').toMatch(/__x_id/);
  });

  it('is actually APPLIED to the installed package', () => {
    const file = installedUtilsJs();
    expect(file, 'no installed whatsapp-web.js@1.34.7 found — run pnpm install').not.toBeNull();

    const src = readFileSync(file!, 'utf8');
    expect(
      src,
      'the patch is in git but not in node_modules — a peer bump can silently drop it',
    ).toMatch(/omitModelInternals/);
  });

  it('no longer spreads the raw model into the message', () => {
    const file = installedUtilsJs();
    const src = readFileSync(file!, 'utf8');

    // The bare spread is the bug. It must go through the helper instead.
    const bare = src.match(/^\s*\.\.\.mediaOptions,\s*$/m);
    expect(
      bare,
      'found a bare `...mediaOptions` spread — that is the line that leaks __x_id',
    ).toBeNull();
    expect(src).toMatch(/\.\.\.window\.WWebJS\.omitModelInternals\(mediaOptions\)/);
  });
});

// The receiving side of the same patch. WhatsApp Web's DownloadManager now checks the decrypted
// file against the declared mimetype; whatsapp-web.js 1.34.7 never passes it, so the default
// `application/octet-stream` makes `downloadMedia()` throw
//
//     InvalidMediaFileType: Unexpected mimetype application/octet-stream for media type image
//
// for every image (and video, sticker, voice note). Documents still pass, which is why the damage
// looked partial: incoming images simply stopped being stored. Puppeteer reports the in-page error
// as an opaque `t: t` (WhatsApp minifies its error classes), so the log said only
// "Failed to download media: t". The patch forwards `msg.mimetype` and rethrows with the real text.
describe('whatsapp-web.js inbound media download patch', () => {
  it('the patch forwards the declared mimetype and keeps the real error text', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toMatch(/^\+\s+mimetype: msg\.mimetype,$/m);
    expect(patch).toMatch(/^\+\s+throw new Error\(`\$\{e && e\.name\}: \$\{e && e\.message\}`\);$/m);
  });

  it('is actually APPLIED: the DownloadManager call carries the mimetype', () => {
    const file = installedMessageJs();
    expect(file, 'no installed whatsapp-web.js@1.34.7 found — run pnpm install').not.toBeNull();

    const src = readFileSync(file!, 'utf8');
    // The argument object of downloadAndMaybeDecrypt({ ... }), up to its closing `});`.
    const call = src.match(/downloadAndMaybeDecrypt\(\{([\s\S]*?)\}\);/);
    expect(call, 'downloadAndMaybeDecrypt call not found — did whatsapp-web.js change?').not.toBeNull();
    expect(
      call![1],
      'without `mimetype` WhatsApp Web throws InvalidMediaFileType for every image',
    ).toMatch(/\bmimetype:\s*msg\.mimetype\b/);
  });

  it('no longer rethrows the opaque in-page error', () => {
    const src = readFileSync(installedMessageJs()!, 'utf8');
    // Plain string search on purpose: a regex over the comment lines in between backtracks badly.
    const at = src.indexOf('status === 404) return undefined;');
    expect(at, 'the 404 branch of downloadMedia was not found — did whatsapp-web.js change?').toBeGreaterThan(-1);
    const rest = src.slice(at, at + 400);
    expect(rest, 'the catch should rethrow with the real name and message').toContain('throw new Error(');
    expect(rest, 'a bare `throw e` loses the cause behind WhatsApp\'s minified `t: t`').not.toMatch(/\bthrow e;/);
  });
});

// Incoming calls. Current WhatsApp Web sets WAWebCallCollection's `activeCall` instead
// of filling its internal map, so whatsapp-web.js 1.34.7's map hook never fires and
// `client.on('call')` stays silent; its reject stanza is ignored too
// (wwebjs/whatsapp-web.js#201825, #201746). The patch listens to `change:activeCall`,
// reports the end of a call (`multiwa_call_ended`) and rejects through the voip stack.
// whatsapp-web.js also never emits `message_create` for a call-log message ("Missed voice
// call"): it adds one before WhatsApp marks it new. The patch forwards call logs itself
// (`multiwa_call_log`), because that message carries the call's final outcome.
// Two more things moved: `Client#createCallLink` asks for WAWebGenerateEventCallLink, which no
// longer exists (WhatsApp's own "Create call link" is WAWebVoipCreateCallLink, in a lazily loaded
// bundle), and `WAWebCallCollection` has no `activeCall` any more, so the reject guard reads the
// id the call hook tracks (`window._multiwaCallId`) instead.
const installedClientJs = () => installedFile(['src', 'Client.js'], 'onMultiwaCallEnded');
const installedUtilsJsWithReject = () => installedFile(['src', 'util', 'Injected', 'Utils.js'], 'WAWebVoipStackInterface');

describe('whatsapp-web.js call patch', () => {
  it('the patch carries the activeCall listener, the end event and the voip-stack reject', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toMatch(/^\+.*change:activeCall/m);
    expect(patch).toMatch(/^\+.*onMultiwaCallEnded/m);
    expect(patch).toMatch(/^\+.*WAWebVoipStackInterface/m);
  });

  it('the patch forwards call-log messages', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toMatch(/^\+.*onMultiwaCallLog/m);
    expect(patch).toMatch(/^\+.*multiwa_call_log/m);
  });

  it('the patch creates call links through WAWebVoipCreateCallLink and guards rejects on _multiwaCallId', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toMatch(/^\+.*WAWebVoipCreateCallLink/m);
    // _multiwaCallId is already in the call hook (Client.js): the reject guard is the Utils.js hunk.
    const utils = patch.split(/^diff --git /m).find((part) => part.startsWith('a/src/util/Injected/Utils.js'));
    expect(utils, 'Utils.js is no longer part of the patch').toBeDefined();
    expect(utils).toMatch(/^\+.*window\._multiwaCallId/m);
  });

  it('is actually APPLIED to the installed Client.js', () => {
    const file = installedClientJs();
    expect(file, 'no installed whatsapp-web.js@1.34.7 found — run pnpm install').not.toBeNull();
    const src = readFileSync(file!, 'utf8');
    expect(src).toContain("WAWebCallCollection.on('change:activeCall'");
    expect(src).toContain("exposeFunctionIfAbsent(this.pupPage, 'onMultiwaCallEnded'");
    expect(src).toContain("this.emit('multiwa_call_ended'");
    expect(src).toContain("exposeFunctionIfAbsent(this.pupPage, 'onMultiwaCallLog'");
    expect(src).toContain("this.emit('multiwa_call_log'");
    expect(src).toContain("Msg.on('add', reportCallLog)");
    expect(src).toContain("'WAWebVoipCreateCallLink'");
    expect(src).toContain("'WAWebVoipCreateCallLinksPopup.react'");
  });

  it('rejects through the voip stack before the old stanza', () => {
    const src = readFileSync(installedUtilsJsWithReject()!, 'utf8');
    const start = src.indexOf('window.WWebJS.rejectCall = async');
    const end = src.indexOf('window.WWebJS.cropAndResizeImage', start);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end);
    expect(body.indexOf('WAWebVoipStackInterface')).toBeGreaterThan(-1);
    expect(body.indexOf('WAWebVoipStackInterface')).toBeLessThan(body.indexOf('deprecatedCastStanza'));
  });

  it('guards the reject on the id the call hook tracks: WAWebCallCollection has no activeCall any more', () => {
    const src = readFileSync(installedUtilsJsWithReject()!, 'utf8');
    const start = src.indexOf('window.WWebJS.rejectCall = async');
    const body = src.slice(start, src.indexOf('window.WWebJS.cropAndResizeImage', start));
    expect(body).toContain('window._multiwaCallId');
    expect(body).not.toContain('WAWebCallCollection');
  });
});

// ---- Behaviour specs for the in-page call hook and rejectCall ----
// The block runs inside WhatsApp Web, so CI cannot start it; this evaluates the INSTALLED source against a
// Backbone-style fake collection (trigger() has no try/catch, like WhatsApp's EventEmitter).
const sliceBetween = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`markers moved in the patched file: ${from} .. ${to}`);
  return src.slice(a, b);
};

// `onThrowsOnce`: the first `collection.on(...)` throws, and the harness does NOT inject by itself,
// so the test can watch that first injection fail (`inject()` runs the block in the same `window`).
// `noCollection`: a build without WAWebCallCollection (the call hook is skipped, the rest of the block still runs).
// The block also hangs the call-log listener on `Msg`, a free variable of the evaluate callback: a tiny emitter here.
const callHook = (opts: { onThrowsOnce?: boolean; noCollection?: boolean } = {}) => {
  const block = sliceBetween(
    readFileSync(installedClientJs()!, 'utf8'),
    "const WAWebCallCollection = window.require('WAWebCallCollection');",
    "Chat.on('remove'",
  );
  const handlers: Record<string, Array<(...a: any[]) => void>> = {};
  let failNextOn = !!opts.onThrowsOnce;
  const collection: any = {
    _map: new Map(),
    on: (ev: string, fn: (...a: any[]) => void) => {
      if (failNextOn) {
        failNextOn = false;
        throw new Error('listener registration failed');
      }
      return (handlers[ev] ||= []).push(fn);
    },
    trigger: (ev: string, ...a: any[]) => handlers[ev]?.forEach((fn) => fn(...a)),
  };
  const msgHandlers: Record<string, Array<(...a: any[]) => void>> = {};
  const Msg = {
    on: (ev: string, fn: (...a: any[]) => void) => (msgHandlers[ev] ||= []).push(fn),
    trigger: (ev: string, ...a: any[]) => msgHandlers[ev]?.forEach((fn) => fn(...a)),
  };
  const reported: string[] = [];
  const ended: string[] = [];
  const callLogs: any[] = [];
  const win: any = {
    require: () => (opts.noCollection ? undefined : collection),
    onIncomingCall: (c: any) => reported.push(c.id),
    onMultiwaCallEnded: (d: any) => ended.push(d.id),
    onMultiwaCallLog: (m: any) => callLogs.push(m),
    WWebJS: { getMessageModel: (m: any) => ({ ...m }) }, // the real one serializes the model; a copy keeps each snapshot apart
  };
  const inject = () => new Function('window', 'Msg', block)(win, Msg);
  if (!opts.onThrowsOnce) inject();
  const call = (id: string, state?: number) => ({ id, peerJid: { $1: `${id}@c.us` }, getState: () => state });
  return { collection, handlers, reported, ended, win, call, inject, activate: (c?: any) => collection.trigger('change:activeCall', c), Msg, msgHandlers, callLogs };
};

describe('whatsapp-web.js call hook behaviour', () => {
  it('reports a call once and its end once', () => {
    const h = callHook();
    h.activate(h.call('A', 3)); h.activate(h.call('A', 3)); h.activate(undefined); h.activate(undefined);
    expect({ r: h.reported, e: h.ended }).toEqual({ r: ['A'], e: ['A'] });
  });

  it('reports a call whose state is not applied yet (WhatsApp sets it right after setActiveCall returns)', () => {
    const h = callHook();
    h.activate(h.call('A', undefined));
    h.activate(h.call('B', 0));
    expect(h.reported).toEqual(['A', 'B']);
    expect(h.ended, 'B is new: its state 0 is the unset default, not the end of the call').toEqual(['A']);
  });

  it('ends a call that another call displaced from the single active slot', () => {
    const h = callHook();
    h.activate(h.call('A', 3)); h.activate(h.call('B', 3)); h.activate(undefined);
    expect(h.ended).toEqual(['A', 'B']);
  });

  it('ends a known call that comes back as a new object in state 0', () => {
    const h = callHook();
    h.activate(h.call('A', 3)); h.activate(h.call('A', 0));
    expect(h.ended, 'state 0 ends the call by itself, without waiting for the slot to clear').toEqual(['A']);
    h.activate(undefined);
    expect({ r: h.reported, e: h.ended }, 'and the cleared slot does not end it a second time').toEqual({ r: ['A'], e: ['A'] });
  });

  it('never lets a failing hook throw into WhatsApp (it runs inside setActiveCall and Map.set)', () => {
    const h = callHook();
    // K is a KNOWN call from here on, so the next activation really asks the model for its state.
    h.activate(h.call('K', 3));
    expect(() => h.activate({ id: 'K', getState: () => { throw new Error('half-built model'); } })).not.toThrow();
    expect(h.win._multiwaLastError, 'getState ran, threw, and left its trace on the page').toMatch(/half-built model/);

    h.win.onIncomingCall = () => { throw new TypeError('boom'); };
    expect(() => h.activate(h.call('A', 3))).not.toThrow();
    expect(h.win._multiwaLastError, 'a swallowed error stays readable from the live page').toMatch(/boom/);
    expect(() => h.collection._map.set('k', h.call('M', 3))).not.toThrow();
    expect(h.collection._map.has('k'), 'WhatsApp must still record the call').toBe(true);
  });

  it('registers one listener and wraps the map once however often it is injected', () => {
    const h = callHook();
    const wrapped = h.collection._map.set;
    expect(wrapped, 'the map fallback is installed').not.toBe(Map.prototype.set);
    h.inject(); h.inject();
    expect(h.handlers['change:activeCall']).toHaveLength(1);
    expect(h.collection._map.set, 're-injecting must not wrap the wrapper again').toBe(wrapped);
  });

  it('a first injection that fails in collection.on leaves the next one to register the listener', () => {
    const h = callHook({ onThrowsOnce: true });
    try {
      h.inject();
    } catch {
      // whether the failure surfaces is not the point: the next injection must still register
    }
    expect(h.handlers['change:activeCall'] ?? []).toHaveLength(0);
    h.inject();
    expect(h.handlers['change:activeCall'], 'the "registered" flag is set only after on() succeeded').toHaveLength(1);
    h.activate(h.call('A', 3));
    expect(h.reported).toEqual(['A']);
  });
});

// A live call log is ADDED with `isNewMsg` unset and outcome Ongoing, CHANGES to `isNewMsg: true` (still Ongoing),
// and a few ms after the call's slot clears changes to the final outcome; every change fires twice. History
// replays (about 230 events on connect) keep `isNewMsg` unset and must stay out, or old calls would be acted on.
describe('whatsapp-web.js call-log forwarding behaviour', () => {
  const callLog = (extra: Record<string, unknown> = {}) => ({
    id: 'false_123456@lid_00A9D2BADD351F56B87282EBA95ABCDE', type: 'call_log', callOutcome: 'Ongoing', isNewMsg: true, ...extra,
  });

  it('forwards a new call log when it is added and again on every change', () => {
    const h = callHook();
    const msg = callLog();
    h.Msg.trigger('add', msg);
    msg.callOutcome = 'Missed';
    h.Msg.trigger('change', msg);
    h.Msg.trigger('change', msg); // WhatsApp fires each change twice; the adapter dedupes
    expect(h.callLogs.map((m) => m.callOutcome)).toEqual(['Ongoing', 'Missed', 'Missed']);
    expect(h.callLogs[0]).toMatchObject({ id: msg.id, type: 'call_log' });
  });

  it('follows a live call: added unmarked, marked new, then its final outcome', () => {
    const h = callHook();
    const msg: any = callLog({ isNewMsg: undefined });
    h.Msg.trigger('add', msg);
    expect(h.callLogs, 'added with isNewMsg unset: not forwarded yet').toEqual([]);
    msg.isNewMsg = true;
    h.Msg.trigger('change', msg);
    msg.callOutcome = 'Rejected';
    h.Msg.trigger('change', msg);
    expect(h.callLogs.map((m) => m.callOutcome)).toEqual(['Ongoing', 'Rejected']);
  });

  it('leaves out history replays (isNewMsg not true) and messages that are not call logs', () => {
    const h = callHook();
    h.Msg.trigger('add', callLog({ isNewMsg: undefined }));
    h.Msg.trigger('add', callLog({ isNewMsg: false }));
    h.Msg.trigger('change', callLog({ isNewMsg: 1 })); // only a real `true` counts
    h.Msg.trigger('add', callLog({ type: 'chat' }));
    h.Msg.trigger('change', callLog({ type: 'chat' }));
    h.Msg.trigger('add', undefined);
    h.Msg.trigger('change', null);
    expect(h.callLogs).toEqual([]);
  });

  it('never lets a failing page function throw into WhatsApp, and keeps the error readable', () => {
    const h = callHook();
    h.win.onMultiwaCallLog = () => { throw new TypeError('the node side is gone'); };
    expect(() => h.Msg.trigger('add', callLog())).not.toThrow();
    expect(h.win._multiwaLastError).toMatch(/the node side is gone/);

    h.win._multiwaLastError = undefined;
    h.win.WWebJS.getMessageModel = () => { throw new Error('half-built model'); };
    expect(() => h.Msg.trigger('change', callLog())).not.toThrow();
    expect(h.win._multiwaLastError).toMatch(/half-built model/);
  });

  it('registers one add and one change listener however often it is injected', () => {
    const h = callHook();
    h.inject(); h.inject();
    expect(h.msgHandlers.add).toHaveLength(1);
    expect(h.msgHandlers.change).toHaveLength(1);
    h.Msg.trigger('add', callLog());
    expect(h.callLogs, 'one listener, one forward').toHaveLength(1);
  });

  it('still registers on a build without the call collection', () => {
    const h = callHook({ noCollection: true });
    expect(h.handlers['change:activeCall'] ?? []).toHaveLength(0);
    h.Msg.trigger('add', callLog());
    expect(h.callLogs).toHaveLength(1);
  });
});

// The node side of `multiwa_call_log`: the function the patch exposes to the page. The INSTALLED attachEventListeners
// runs against a fake page that records what it is asked to expose.
describe('whatsapp-web.js onMultiwaCallLog (node side)', () => {
  const exposeOnMultiwaCallLog = async () => {
    const Client = createRequire(__filename)(installedClientJs()!);
    const exposed: Record<string, (...a: any[]) => unknown> = {};
    const client: any = Object.assign(new EventEmitter(), {
      pupPage: { evaluate: async () => false, exposeFunction: async (name: string, fn: (...a: any[]) => unknown) => { exposed[name] = fn; } },
    });
    await Client.prototype.attachEventListeners.call(client);
    return { client, onMultiwaCallLog: exposed.onMultiwaCallLog };
  };
  const liveLog = {
    id: { fromMe: false, remote: '1234567@lid', id: '00A9D2BADD351F56B87282EBA95ABCDE', _serialized: 'false_1234567@lid_00A9D2BADD351F56B87282EBA95ABCDE' },
    type: 'call_log', from: { server: 'lid', user: '1234567', _serialized: '1234567@lid' }, t: 1793051495, callOutcome: 'Missed', isVideoCall: false,
  };

  it('emits multiwa_call_log with a whatsapp-web.js Message', async () => {
    const { client, onMultiwaCallLog } = await exposeOnMultiwaCallLog();
    const emitted: any[] = [];
    client.on('multiwa_call_log', (m: any) => emitted.push(m));
    onMultiwaCallLog(liveLog);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: 'call_log', fromMe: false, from: '1234567@lid', timestamp: 1793051495 });
  });

  it('logs a payload it cannot turn into a Message instead of throwing it back at the page', async () => {
    const { client, onMultiwaCallLog } = await exposeOnMultiwaCallLog();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const emitted: any[] = [];
    client.on('multiwa_call_log', (m: any) => emitted.push(m));
    try {
      expect(() => onMultiwaCallLog({ type: 'call_log' })).not.toThrow(); // no `id`: Message cannot be built
      expect(emitted).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0].join(' ')).toMatch(/call-log message dropped/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('whatsapp-web.js rejectCall behaviour', () => {
  // `voip`: the whole WAWebVoipStackInterface module (overrides `stack`); neither: the module does not exist.
  // `callId`: the id the call hook tracks on the page (`window._multiwaCallId`; null once the call ended, unset before any call).
  // `required`: filled with the name of every module the function asks for.
  const rejectCall = async (opts: { stack?: any; voip?: any; callId?: string | null; requested?: string; required?: string[] }) => {
    const src = readFileSync(installedUtilsJsWithReject()!, 'utf8');
    const fn = sliceBetween(src, 'window.WWebJS.rejectCall = async', 'window.WWebJS.cropAndResizeImage');
    const stanzas: unknown[] = [];
    const win: any = { WWebJS: {}, _multiwaCallId: opts.callId };
    win.require = (name: string) => {
      opts.required?.push(name);
      if (name === 'WAWebVoipStackInterface') {
        if (opts.voip) return opts.voip;
        if (!opts.stack) throw new Error('Requiring unknown module');
        return { getVoipStackInterface: async () => opts.stack };
      }
      if (name === 'WAWap') return { wap: (...a: any[]) => a, generateId: () => 'id' };
      if (name === 'WADeprecatedSendIq') return { deprecatedCastStanza: async (s: unknown) => { stanzas.push(s); } };
      if (name === 'WAWebUserPrefsMeUser') return { getMaybeMePnUser: () => ({ _serialized: 'me@c.us' }) };
      throw new Error(`unexpected module ${name}`);
    };
    new Function('window', fn)(win);
    const result = await win.WWebJS.rejectCall('peer@c.us', opts.requested ?? 'A').then(() => 'ok', (e: Error) => e.message);
    return { result, stanzas };
  };

  it('uses the voip stack and not the stanza when the stack works', async () => {
    const stack = { rejectCall: vi.fn().mockResolvedValue(undefined) };
    expect(await rejectCall({ stack, callId: 'A' })).toEqual({ result: 'ok', stanzas: [] });
    expect(stack.rejectCall).toHaveBeenCalledTimes(1);
  });

  it('lets a real voip failure reach the caller instead of "succeeding" through the stanza', async () => {
    const stack = { rejectCall: vi.fn().mockRejectedValue(new Error('voip: no active call')) };
    expect(await rejectCall({ stack, callId: 'A' })).toEqual({ result: 'voip: no active call', stanzas: [] });
  });

  it('refuses to reject a different call than the one asked for (the stack takes no id)', async () => {
    const stack = { rejectCall: vi.fn() };
    const out = await rejectCall({ stack, callId: 'B', requested: 'A' });
    expect(out.result).toMatch(/not the active call/);
    expect(stack.rejectCall).not.toHaveBeenCalled();
    expect(out.stanzas).toEqual([]);
  });

  it('goes ahead when the hook tracks no call (never reported one, or it already ended): fail open, never to the stanza', async () => {
    for (const callId of [undefined, null]) {
      const stack = { rejectCall: vi.fn().mockResolvedValue(undefined) };
      expect(await rejectCall({ stack, callId }), `callId ${callId}`).toEqual({ result: 'ok', stanzas: [] });
      expect(stack.rejectCall, `callId ${callId}`).toHaveBeenCalledTimes(1);
    }
  });

  it('decides from the page\'s own tracking and never asks WhatsApp\'s call collection (it has no activeCall)', async () => {
    const stack = { rejectCall: vi.fn().mockResolvedValue(undefined) };
    const required: string[] = [];
    await rejectCall({ stack, callId: 'A', required });
    expect(required).toContain('WAWebVoipStackInterface'); // the harness does record what it was asked for
    expect(required).not.toContain('WAWebCallCollection');
  });

  it('a voip module whose stack cannot be fetched fails loudly, never via the stanza', async () => {
    const voip = { getVoipStackInterface: vi.fn().mockRejectedValue(new Error('voip: stack unavailable')) };
    expect(await rejectCall({ voip })).toEqual({ result: 'voip: stack unavailable', stanzas: [] });
  });

  it('a voip module without a usable stack fails loudly', async () => {
    for (const stack of [null, {}]) {
      const out = await rejectCall({ voip: { getVoipStackInterface: async () => stack } });
      expect(out.result, `stack ${JSON.stringify(stack)}`).toMatch(/cannot reject calls/);
      expect(out.stanzas, `stack ${JSON.stringify(stack)}`).toEqual([]);
    }
  });

  it('falls back to the stanza only when the build has no voip stack', async () => {
    const out = await rejectCall({});
    expect(out.result).toBe('ok');
    expect(out.stanzas).toHaveLength(1);
  });
});

// `Client#createCallLink`: the evaluate callback runs inside WhatsApp Web, so CI evaluates the INSTALLED callback
// against a fake `window.require`. `WAWebGenerateEventCallLink` (what whatsapp-web.js asks for) is gone from current
// WhatsApp Web; its own "Create call link" is `WAWebVoipCreateCallLink.createCallLink`, in a lazily loaded bundle that
// `JSResourceForInteraction(...).load()` brings in (`requireLazy` does not). It rejects on a server nack.
// Only getting at the modules may fail quietly (an older build falls back to the old API); once WhatsApp has been
// asked, its answer reaches the caller, and nothing waits forever (evaluate would hang until protocolTimeout, 240 s).
describe('whatsapp-web.js createCallLink behaviour', () => {
  const BUNDLE = 'WAWebVoipCreateCallLinksPopup.react';
  const TIMEOUT_MS = 25_000;

  // The callback is the first argument of `pupPage.evaluate(` in `createCallLink`: from its `async (startTimeTs, callType) =>`
  // to the `}` in front of the other arguments (`startTime, callType`). Whitespace-tolerant: indentation is not part of the contract.
  const callback = () => {
    const src = readFileSync(installedClientJs()!, 'utf8');
    const from = src.indexOf('async (startTimeTs, callType) =>');
    const end = from < 0 ? -1 : src.slice(from).search(/\},\s*startTime,\s*callType/);
    if (end < 0) throw new Error('markers moved in the patched file: the evaluate callback of createCallLink');
    const text = src.slice(from, from + end + 1);
    return (win: any): ((startTimeTs: number, callType: string) => Promise<string>) => new Function('window', `return (${text});`)(win);
  };

  // `present`: modules `require` knows right away. `lazy`: what the lazy bundle adds once loaded. `missing`: how require
  // reports an unknown module: it throws, or (as `WAWebGenerateEventCallLink` does on a live page) gives undefined.
  // `noLoader`: the build has no JSResourceForInteraction. `loadFails` / `loadHangs`: `.load()` rejects / never settles.
  const run = async (opts: {
    present?: Record<string, any>; lazy?: Record<string, any>; missing?: 'throw' | 'undefined'; callType?: string;
    noLoader?: boolean; loadFails?: Error; loadHangs?: boolean;
  }) => {
    const modules: Record<string, any> = { ...opts.present };
    const loaded: string[] = [];
    const win: any = {
      require: (name: string) => {
        if (name === 'JSResourceForInteraction' && !opts.noLoader) {
          return (resource: string) => ({
            load: async () => {
              loaded.push(resource);
              if (opts.loadHangs) return new Promise(() => undefined);
              if (opts.loadFails) throw opts.loadFails;
              Object.assign(modules, opts.lazy);
            },
          });
        }
        if (name in modules) return modules[name];
        if (opts.missing === 'undefined') return undefined;
        throw new Error(`Requiring unknown module "${name}"`);
      },
    };
    const outcome: { link?: string; error?: string } = await callback()(win)(1_790_000_000, opts.callType ?? 'voice').then(
      (link) => ({ link }),
      (error: Error) => ({ error: error.message }),
    );
    return { ...outcome, loaded };
  };

  const link = (impl: (arg: any) => any = async () => 'https://call.whatsapp.com/voice/token') => ({
    WAWebVoipCreateCallLink: { createCallLink: vi.fn(impl) },
  });
  const legacy = (impl: (...a: any[]) => any = async () => 'https://call.whatsapp.com/video/old') => ({
    WAWebGenerateEventCallLink: { createEventCallLink: vi.fn(impl) },
  });

  it.each([
    ['voice', 'audio'],
    ['video', 'video'],
  ])('asks WhatsApp\'s own "Create call link" for a %s link (callType %s, no approval) and returns the link', async (type, callType) => {
    const present = link(async () => `https://call.whatsapp.com/${type}/token`);
    const out = await run({ present, callType: type });
    expect(out).toEqual({ link: `https://call.whatsapp.com/${type}/token`, loaded: [] });
    expect(present.WAWebVoipCreateCallLink.createCallLink).toHaveBeenCalledTimes(1);
    expect(present.WAWebVoipCreateCallLink.createCallLink).toHaveBeenCalledWith({ callType, requireApproval: false });
  });

  it('loads the lazy bundle the way WhatsApp does when the module is not there yet, then uses it', async () => {
    for (const missing of ['throw', 'undefined'] as const) {
      const lazy = link();
      const out = await run({ lazy, missing });
      expect(out, missing).toEqual({ link: 'https://call.whatsapp.com/voice/token', loaded: [BUNDLE] });
      expect(lazy.WAWebVoipCreateCallLink.createCallLink, missing).toHaveBeenCalledWith({ callType: 'audio', requireApproval: false });
    }
  });

  it('falls back to the old WAWebGenerateEventCallLink when neither the module nor the bundle gives the new API', async () => {
    const present = legacy();
    expect(await run({ present, callType: 'video' })).toEqual({ link: 'https://call.whatsapp.com/video/old', loaded: [BUNDLE] });
    expect(present.WAWebGenerateEventCallLink.createEventCallLink).toHaveBeenCalledWith(1_790_000_000, 'video');
    // A module that exists without the function is not the new API either.
    const odd = { WAWebVoipCreateCallLink: {}, ...legacy() };
    expect((await run({ present: odd })).link).toBe('https://call.whatsapp.com/video/old');
  });

  it('falls back to the old API when the build has no lazy loader at all', async () => {
    for (const missing of ['throw', 'undefined'] as const) {
      const present = legacy();
      expect(await run({ present, noLoader: true, missing }), missing).toEqual({ link: 'https://call.whatsapp.com/video/old', loaded: [] });
      expect(present.WAWebGenerateEventCallLink.createEventCallLink, missing).toHaveBeenCalledTimes(1);
    }
  });

  it('falls back to the old API when loading the bundle fails', async () => {
    const present = legacy();
    const out = await run({ present, loadFails: new Error('Failed to fetch the bundle') });
    expect(out).toEqual({ link: 'https://call.whatsapp.com/video/old', loaded: [BUNDLE] });
    expect(present.WAWebGenerateEventCallLink.createEventCallLink).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when nothing can create a link (never a made-up one)', async () => {
    for (const missing of ['throw', 'undefined'] as const) {
      expect(await run({ missing }), missing).toEqual({ error: 'WhatsApp Web has no call-link API', loaded: [BUNDLE] });
    }
  });

  it('reports why the bundle did not load when that is all it knows', async () => {
    const out = await run({ loadFails: new Error('Failed to fetch the bundle') });
    expect(out).toEqual({ error: 'Failed to fetch the bundle', loaded: [BUNDLE] });
    // No loader at all is a load error too: still an error, never a made-up link.
    for (const missing of ['throw', 'undefined'] as const) {
      const noLoader = await run({ noLoader: true, missing });
      expect(noLoader.error, missing).toBeTruthy();
      expect(noLoader.link, missing).toBeUndefined();
    }
  });

  it('lets a nack reach the caller: no fallback after the new API was asked and refused', async () => {
    const nack = Object.assign(new Error('ServerStatusCodeError 500'), { name: 'ServerStatusCodeError' });
    const refuse = () => link(async () => { throw nack; });
    const there = legacy();
    expect(await run({ present: { ...refuse(), ...there } })).toEqual({ error: 'ServerStatusCodeError 500', loaded: [] });
    const later = legacy();
    expect(await run({ present: later, lazy: refuse() })).toEqual({ error: 'ServerStatusCodeError 500', loaded: [BUNDLE] });
    expect(there.WAWebGenerateEventCallLink.createEventCallLink).not.toHaveBeenCalled();
    expect(later.WAWebGenerateEventCallLink.createEventCallLink).not.toHaveBeenCalled();
  });

  it('hands back an empty string when WhatsApp answers without a link (the adapter turns that into an error)', async () => {
    for (const answer of [undefined, null]) {
      const out = await run({ present: link(async () => answer) });
      expect(out.link, String(answer)).toBe('');
    }
  });

  describe('never waits forever', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    // Nothing settles just before the timeout; the rejection (or the fallback) comes with it.
    const afterTimeout = async <T>(pending: Promise<T>): Promise<T> => {
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      expect(settled, 'still waiting 1 ms before the timeout').toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      return pending;
    };

    it('stops waiting for a bundle that never loads', async () => {
      const out = await afterTimeout(run({ loadHangs: true }));
      expect(out.error).toContain('timed out');
      expect(out.loaded).toEqual([BUNDLE]);
    });

    it('falls back to the old API when the bundle never loads', async () => {
      const present = legacy();
      const out = await afterTimeout(run({ present, loadHangs: true }));
      expect(out).toEqual({ link: 'https://call.whatsapp.com/video/old', loaded: [BUNDLE] });
    });

    it('stops waiting for a link that WhatsApp never answers, and does not fall back', async () => {
      const old = legacy();
      const present = { ...link(() => new Promise(() => undefined)), ...old };
      const out = await afterTimeout(run({ present }));
      expect(out.error).toContain('timed out');
      expect(old.WAWebGenerateEventCallLink.createEventCallLink).not.toHaveBeenCalled();
    });

    it('leaves no timer behind once WhatsApp has answered', async () => {
      expect((await run({ present: link() })).link).toBe('https://call.whatsapp.com/voice/token');
      expect(vi.getTimerCount()).toBe(0);
      await run({ present: link(async () => { throw new Error('nack'); }) });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

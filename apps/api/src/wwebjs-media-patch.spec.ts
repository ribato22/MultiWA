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
import path from 'path';
import { describe, it, expect, vi } from 'vitest';

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
const installedClientJs = () => installedFile(['src', 'Client.js'], 'onMultiwaCallEnded');
const installedUtilsJsWithReject = () => installedFile(['src', 'util', 'Injected', 'Utils.js'], 'WAWebVoipStackInterface');

describe('whatsapp-web.js call patch', () => {
  it('the patch carries the activeCall listener, the end event and the voip-stack reject', () => {
    const patch = readFileSync(PATCH_FILE, 'utf8');
    expect(patch).toMatch(/^\+.*change:activeCall/m);
    expect(patch).toMatch(/^\+.*onMultiwaCallEnded/m);
    expect(patch).toMatch(/^\+.*WAWebVoipStackInterface/m);
  });

  it('is actually APPLIED to the installed Client.js', () => {
    const file = installedClientJs();
    expect(file, 'no installed whatsapp-web.js@1.34.7 found — run pnpm install').not.toBeNull();
    const src = readFileSync(file!, 'utf8');
    expect(src).toContain("WAWebCallCollection.on('change:activeCall'");
    expect(src).toContain("exposeFunctionIfAbsent(this.pupPage, 'onMultiwaCallEnded'");
    expect(src).toContain("this.emit('multiwa_call_ended'");
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
const callHook = (opts: { onThrowsOnce?: boolean } = {}) => {
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
  const reported: string[] = [];
  const ended: string[] = [];
  const win: any = {
    require: () => collection,
    onIncomingCall: (c: any) => reported.push(c.id),
    onMultiwaCallEnded: (d: any) => ended.push(d.id),
  };
  const inject = () => new Function('window', block)(win);
  if (!opts.onThrowsOnce) inject();
  const call = (id: string, state?: number) => ({ id, peerJid: { $1: `${id}@c.us` }, getState: () => state });
  return { collection, handlers, reported, ended, win, call, inject, activate: (c?: any) => collection.trigger('change:activeCall', c) };
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
    expect(() => h.inject()).toThrow('listener registration failed');
    expect(h.handlers['change:activeCall'] ?? []).toHaveLength(0);
    h.inject();
    expect(h.handlers['change:activeCall'], 'the "registered" flag is set only after on() succeeded').toHaveLength(1);
    h.activate(h.call('A', 3));
    expect(h.reported).toEqual(['A']);
  });
});

describe('whatsapp-web.js rejectCall behaviour', () => {
  // `voip`: the whole WAWebVoipStackInterface module (overrides `stack`); neither: the module does not exist.
  const rejectCall = async (opts: { stack?: any; voip?: any; active?: any; requested?: string }) => {
    const src = readFileSync(installedUtilsJsWithReject()!, 'utf8');
    const fn = sliceBetween(src, 'window.WWebJS.rejectCall = async', 'window.WWebJS.cropAndResizeImage');
    const stanzas: unknown[] = [];
    const win: any = { WWebJS: {} };
    win.require = (name: string) => {
      if (name === 'WAWebVoipStackInterface') {
        if (opts.voip) return opts.voip;
        if (!opts.stack) throw new Error('Requiring unknown module');
        return { getVoipStackInterface: async () => opts.stack };
      }
      if (name === 'WAWebCallCollection') return { activeCall: opts.active };
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
    expect(await rejectCall({ stack, active: { id: 'A' } })).toEqual({ result: 'ok', stanzas: [] });
    expect(stack.rejectCall).toHaveBeenCalledTimes(1);
  });

  it('lets a real voip failure reach the caller instead of "succeeding" through the stanza', async () => {
    const stack = { rejectCall: vi.fn().mockRejectedValue(new Error('voip: no active call')) };
    expect(await rejectCall({ stack, active: { id: 'A' } })).toEqual({ result: 'voip: no active call', stanzas: [] });
  });

  it('refuses to reject a different call than the one asked for (the stack takes no id)', async () => {
    const stack = { rejectCall: vi.fn() };
    const out = await rejectCall({ stack, active: { id: 'B' }, requested: 'A' });
    expect(out.result).toMatch(/not the active call/);
    expect(stack.rejectCall).not.toHaveBeenCalled();
    expect(out.stanzas).toEqual([]);
  });

  it('still rejects when the active call cannot be read (fail open, never to the stanza)', async () => {
    const stack = { rejectCall: vi.fn().mockResolvedValue(undefined) };
    expect(await rejectCall({ stack, active: undefined })).toEqual({ result: 'ok', stanzas: [] });
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

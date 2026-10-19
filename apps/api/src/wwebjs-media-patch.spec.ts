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
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PATCH_FILE = path.join(REPO_ROOT, 'patches', 'whatsapp-web.js@1.34.7.patch');

/** An installed source file, found through pnpm's peer-hash directory name. */
function installedFile(relative: string[], marker: string): string | null {
  const pnpmDir = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const candidates = readdirSync(pnpmDir)
    .filter((d) => d.startsWith('whatsapp-web.js@1.34.7'))
    .map((d) => path.join(pnpmDir, d, 'node_modules', 'whatsapp-web.js', ...relative))
    .filter((p) => existsSync(p));
  // A stale hash dir can linger after a re-patch; the patched one is what counts.
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

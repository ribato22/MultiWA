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

/** The installed copy, found through pnpm's peer-hash directory name. */
function installedUtilsJs(): string | null {
  const pnpmDir = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const candidates = readdirSync(pnpmDir)
    .filter((d) => d.startsWith('whatsapp-web.js@1.34.7'))
    .map((d) => path.join(pnpmDir, d, 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js'))
    .filter((p) => existsSync(p));
  // A stale hash dir can linger after a re-patch; the patched one is what counts.
  const patched = candidates.find((p) => readFileSync(p, 'utf8').includes('omitModelInternals'));
  return patched ?? candidates[0] ?? null;
}

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

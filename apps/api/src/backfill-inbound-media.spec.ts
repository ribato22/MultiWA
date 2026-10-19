// scripts/backfill-inbound-media.js: the pure parts (option parsing and the content patch).
//
// The tool re-downloads inbound media that was stored without its file and merges it into
// messages.content. Two things must hold, and both are checked here without a browser or a database:
//   1. nothing is written unless --apply is given, and --since is mandatory (a bare run must never
//      sweep the whole table);
//   2. the patch is exactly what the live path would have stored, size cap included, because it is built
//      by the same applyInboundMedia the engine uses.

import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { applyInboundMedia } from '@multiwa/engine-runtime';

const { parseArgs, contentPatch } = createRequire(__filename)('../../../scripts/backfill-inbound-media.js') as {
  parseArgs: (argv: string[]) => {
    apply: boolean; check: boolean; since: string | null; until: string | null; profile: string | null;
    limit: number; delayMs: number; types: string[];
  };
  contentPatch: (
    media: { mimetype?: string; filename?: string; data?: string } | null | undefined,
    apply: typeof applyInboundMedia,
    maxBytes: number,
  ) => Record<string, unknown> | null;
};

describe('backfill-inbound-media: parseArgs', () => {
  it('is a read-only run by default and needs --since', () => {
    expect(() => parseArgs([])).toThrow(/--since/);
    const o = parseArgs(['--since=2026-10-02']);
    expect(o.apply).toBe(false);
    expect(o.check).toBe(false);
    expect(o.limit).toBe(20);
    expect(o.types).toContain('image');
  });

  it('reads the switches and the key=value options', () => {
    const o = parseArgs(['--since=2026-10-02', '--until=2026-10-19', '--apply', '--check', '--profile=p1', '--limit=5', '--delay-ms=0', '--types=image,video']);
    expect(o).toMatchObject({ apply: true, check: true, since: '2026-10-02', until: '2026-10-19', profile: 'p1', limit: 5, delayMs: 0, types: ['image', 'video'] });
  });

  it('rejects bad input instead of guessing', () => {
    expect(() => parseArgs(['--since=yesterday'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--since=2026-10-02', '--limit=0'])).toThrow(/--limit/);
    expect(() => parseArgs(['--since=2026-10-02', '--types=image,gif'])).toThrow(/--types/);
    expect(() => parseArgs(['--since=2026-10-02', '--wat'])).toThrow(/unknown option/);
  });
});

describe('backfill-inbound-media: contentPatch', () => {
  // 30 bytes -> 40 base64 characters, no padding, so the byte count is exact.
  const jpeg = Buffer.alloc(30, 7).toString('base64');

  it('builds the same fields the live path stores', () => {
    const patch = contentPatch({ mimetype: 'image/jpeg', filename: undefined, data: jpeg }, applyInboundMedia, 1024);
    expect(patch).toMatchObject({ mimetype: 'image/jpeg', hasMedia: true, mediaBytes: 30 });
    expect(patch!.url).toBe(`data:image/jpeg;base64,${jpeg}`);
    expect(patch).not.toHaveProperty('filename'); // undefined must not become a key
  });

  it('keeps oversized media out of the row but still records what it is', () => {
    const patch = contentPatch({ mimetype: 'video/mp4', filename: 'clip.mp4', data: jpeg }, applyInboundMedia, 10);
    expect(patch).toMatchObject({ mimetype: 'video/mp4', filename: 'clip.mp4', mediaOmitted: true, mediaBytes: 30 });
    expect(patch).not.toHaveProperty('url');
  });

  it('returns null when there is nothing to store', () => {
    expect(contentPatch(undefined, applyInboundMedia, 1024)).toBeNull();
    expect(contentPatch(null, applyInboundMedia, 1024)).toBeNull();
    expect(contentPatch({ mimetype: 'image/jpeg' }, applyInboundMedia, 1024)).toBeNull();
  });
});

// MultiWA Gateway - one HTTP byte range (RFC 9110 §14)
// apps/api/src/modules/calls/recordings/byte-range.ts
//
// The recordings route answers `Range: bytes=…` so a player can seek and an integration can stream in parts. One range
// is served: a list of ranges, or anything this does not read, is ignored and the whole file is sent (a server may
// ignore Range, §14.2). A range that starts past the end is 416.

/** Inclusive at both ends, as HTTP counts them. */
export interface ByteRange {
  start: number;
  end: number;
}

// Range units are case-insensitive (§14.1): `Bytes=0-1` is the same request.
const SINGLE = /^bytes=(\d*)-(\d*)$/i;

export function parseByteRange(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  const m = header ? SINGLE.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // bytes=-N: the last N bytes
    const n = Number(m[2]);
    return n === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  if (m[2] !== '' && Number(m[2]) < start) return null; // its end before its start: not a range, ignored
  if (start >= size) return 'unsatisfiable';
  return { start, end: m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) };
}

// MultiWA Gateway - the length a browser's recording lacks, written into it
// apps/api/src/modules/calls/recordings/webm-duration.ts
//
// MediaRecorder writes a live WebM: a Segment and Clusters of unknown size, an Info with no Duration, no SeekHead and
// no Cues. A player then shows no length and cannot seek. finalizeWebm writes a copy with the Duration, counted from
// the file's own last block (a recording cut short by a crash has no other end), and without a block cut off at the
// end. Clusters carry their own time and nothing points at a byte offset, so the 11 bytes added to Info shift nothing
// that matters. Any other layout (a SeekHead, Cues or a Cluster Position, which point at offsets; a Segment of known
// size, which would have to grow; blocks in BlockGroups, which MediaRecorder does not write; more than one Info, or one
// after the Clusters) is copied as it is, and so is a file whose bytes stop making sense anywhere but at its very end.
// A file with no whole block in it, or that is no EBML at all, is copied too, and said to hold no audio: an empty one is
// a recording whose first chunk never came.
// The file is read through a window, never whole: two hours of a call are about 60 MB. Both copies are 0600: a
// recording is this server's user's alone.
import { createReadStream, createWriteStream } from 'fs';
import { chmod, copyFile, open, rm, stat, type FileHandle } from 'fs/promises';
import { pipeline } from 'stream/promises';

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const WINDOW = 64 * 1024;
// The time of a recording's only block, when it has one (TimecodeScale counts nanoseconds): one Opus frame.
const ONE_FRAME_NS = 20_000_000;

export interface FinalizedWebm {
  /** Up to the end of the last whole block, in ms; 0 for a layout copied as it is. */
  durationMs: number;
  /** The copy's size. */
  bytes: number;
  /** False: copied as it is. */
  rewritten: boolean;
  /**
   * True: it has a whole block (rewritten). False: no audio this can read (empty, no EBML at all, or MediaRecorder's
   * layout with no whole block). Null: another layout, not walked.
   */
  audio: boolean | null;
}

interface Header {
  id: number;
  /** Where its data starts (in the buffer's or the file's offsets, whichever was asked for). */
  data: number;
  /** Null: unknown (all ones), as MediaRecorder writes its Segment and Clusters. */
  size: number | null;
}

/** The length of an EBML variable-size number from its first byte, at most `max`; 0 for an invalid one. */
function lengthOf(first: number, max: number): number {
  for (let n = 1; n <= max; n++) if (first & (0x80 >> (n - 1))) return n;
  return 0;
}

/** The element header at `at` in `b` (`base`: the file offset of b[0]); null when `b` ends inside it. */
function headerIn(b: Buffer, at: number, base: number): Header | null {
  const idLen = at < b.length ? lengthOf(b[at], 4) : 0;
  if (!idLen || at + idLen >= b.length) return null;
  const sizeLen = lengthOf(b[at + idLen], 8);
  if (!sizeLen || at + idLen + sizeLen > b.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i];
  const mask = 0xff >> sizeLen;
  let size = b[at + idLen] & mask;
  let unknown = size === mask;
  for (let i = 1; i < sizeLen; i++) {
    size = size * 256 + b[at + idLen + i];
    if (b[at + idLen + i] !== 0xff) unknown = false;
  }
  return { id, data: base + at + idLen + sizeLen, size: unknown ? null : size };
}

const uint = (b: Buffer) => b.reduce((v, x) => v * 256 + x, 0);

/** The elements in `b` (Info's children), each whole. */
function elementsIn(b: Buffer): Array<{ id: number; whole: Buffer; data: Buffer }> {
  const out: Array<{ id: number; whole: Buffer; data: Buffer }> = [];
  for (let at = 0; at < b.length; ) {
    const h = headerIn(b, at, 0);
    if (!h || h.size === null || h.data + h.size > b.length) break;
    out.push({ id: h.id, whole: b.subarray(at, h.data + h.size), data: b.subarray(h.data, h.data + h.size) });
    at = h.data + h.size;
  }
  return out;
}

/** An EBML size of the fewest bytes: 7 bits of value a byte, and all ones kept for "unknown". */
function sizeField(n: number): Buffer {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        b[i] = v % 256;
        v = Math.floor(v / 256);
      }
      b[0] |= 0x80 >> (len - 1);
      return b;
    }
  }
  throw new RangeError(`An EBML size of ${n} is too large`);
}

/** A file read through one window, moved as the walk goes. */
class Reader {
  private buf = Buffer.alloc(0);
  private start = 0;

  constructor(
    private readonly fd: FileHandle,
    readonly size: number,
    readonly windowBytes: number,
  ) {}

  /** The bytes [pos, pos + len), fewer at the end of the file. */
  async at(pos: number, len: number): Promise<Buffer> {
    if (pos < this.start || pos + len > this.start + this.buf.length) {
      const b = Buffer.alloc(Math.max(0, Math.min(Math.max(len, this.windowBytes), this.size - pos)));
      const { bytesRead } = await this.fd.read(b, 0, b.length, pos);
      this.buf = b.subarray(0, bytesRead);
      this.start = pos;
    }
    return this.buf.subarray(pos - this.start, Math.min(pos - this.start + len, this.buf.length));
  }

  async header(pos: number): Promise<Header | null> {
    return headerIn(await this.at(pos, 12), 0, pos);
  }
}

interface Layout {
  info: { start: number; end: number; children: Buffer };
  /** TimecodeScale, in ns. */
  scale: number;
  /** The end of the last whole element: what the copy keeps. */
  end: number;
  /** In TimecodeScale units: the last block's time, and how long after the block before it it came. */
  last: number;
  step: number | null;
}

/**
 * The layout MediaRecorder writes, walked to its last whole element; false for a file with no audio this can read in it
 * (FinalizedWebm.audio); null for any other layout.
 */
async function walk(r: Reader): Promise<Layout | false | null> {
  const ebml = await r.header(0);
  // MediaRecorder starts every file with its EBML header: one without it (an empty file, one cut inside that header,
  // anything else) holds no audio this can read.
  if (!ebml || ebml.id !== EBML) return false;
  if (ebml.size === null) return null;
  const segment = await r.header(ebml.data + ebml.size);
  // A file that ends inside the Segment's header holds no block; 12 bytes there that are no header are another layout.
  if (!segment) return ebml.data + ebml.size + 12 <= r.size ? null : false;
  if (segment.id !== SEGMENT || segment.size !== null) return null;
  let info: Layout['info'] | null = null;
  let scale = 1_000_000;
  let clustered = false;
  let cluster = 0;
  let last: number | null = null;
  let step: number | null = null;
  let end = segment.data;
  for (let pos = segment.data; pos < r.size; ) {
    const e = await r.header(pos);
    if (!e) {
      // Only a file that ends inside a header is cut there: bytes that are no header, with more to come, are not the
      // end of the recording.
      if (pos + 12 <= r.size) return null;
      break;
    }
    if (e.id === CLUSTER) {
      clustered = true;
      pos = e.data; // its children follow; one of unknown size ends where the next Cluster starts
      continue;
    }
    // MediaRecorder's own elements only. Damaged bytes mid-file (a chunk lost to a bug) can read as a header whose size
    // runs past the end, which would pass for a clean cut end and stop the copy at the damage. Any other element (a
    // SeekHead, Cues, a Position or a BlockGroup among them) is copied as it is.
    if (e.size === null || (e.id !== INFO && e.id !== TRACKS && e.id !== TIMECODE && e.id !== SIMPLE_BLOCK)) return null;
    const next = e.data + e.size;
    if (next > r.size) break; // the file ends inside this element: the copy leaves it out
    if (e.id === INFO) {
      // One, before the Clusters, and within a window: it is read whole, and so is all that comes before it.
      if (info || clustered || e.size > r.windowBytes) return null;
      const children = Buffer.from(await r.at(e.data, e.size));
      info = { start: pos, end: next, children };
      const timecodeScale = elementsIn(children).find((c) => c.id === TIMECODE_SCALE);
      if (timecodeScale) scale = uint(timecodeScale.data);
    } else if (e.id === TIMECODE) {
      if (e.size > 8) return null;
      cluster = uint(await r.at(e.data, e.size));
    } else if (e.id === SIMPLE_BLOCK) {
      const head = await r.at(e.data, 12);
      // Its track number, then 2 bytes of time: a block shorter than that has no time to read.
      if (head.length < lengthOf(head[0], 8) + 2) return null;
      const at = cluster + head.readInt16BE(lengthOf(head[0], 8));
      if (last !== null) step = at - last;
      last = at;
    }
    end = next;
    pos = next;
  }
  if (last === null) return false; // walked to its end without a whole block
  return info ? { info, scale, end, last, step } : null;
}

/** Writes `src` to `dst` with its Duration (see the top of this file). */
export async function finalizeWebm(src: string, dst: string, { windowBytes = WINDOW }: { windowBytes?: number } = {}): Promise<FinalizedWebm> {
  const fd = await open(src, 'r');
  let layout: Layout | false | null;
  let before = Buffer.alloc(0);
  try {
    const r = new Reader(fd, (await fd.stat()).size, windowBytes);
    layout = await walk(r);
    if (layout) before = Buffer.from(await r.at(0, layout.info.start));
  } finally {
    await fd.close();
  }
  try {
    if (!layout) {
      await copyFile(src, dst);
      await chmod(dst, 0o600); // copyFile gives the copy its source's mode
      return { durationMs: 0, bytes: (await stat(dst)).size, rewritten: false, audio: layout }; // false or null, as walked
    }
    const { info, scale, end, last, step } = layout;
    const ticks = last + (step ?? ONE_FRAME_NS / scale);
    const duration = Buffer.alloc(11);
    duration.writeUInt16BE(DURATION, 0);
    duration[2] = 0x88; // a size of 8, in one byte
    duration.writeDoubleBE(ticks, 3);
    const body = Buffer.concat([...elementsIn(info.children).filter((c) => c.id !== DURATION).map((c) => c.whole), duration]);
    const head = Buffer.concat([before, Buffer.from([0x15, 0x49, 0xa9, 0x66]), sizeField(body.length), body]);
    await pipeline(
      async function* () {
        yield head;
        if (end > info.end) yield* createReadStream(src, { start: info.end, end: end - 1 });
      },
      createWriteStream(dst, { mode: 0o600 }),
    );
    return { durationMs: Math.round((ticks * scale) / 1e6), bytes: head.length + (end - info.end), rewritten: true, audio: true };
  } catch (e) {
    // A disk that filled up, or a read that failed: no half copy is left for the caller to store. Its own error, not
    // one of the cleanup's, is what it gets.
    await rm(dst, { force: true }).catch(() => undefined);
    throw e;
  }
}

// finalizeWebm on a recording Chrome's MediaRecorder made (fixtures/recorded.webm: 3.42 s, left 440 Hz, right 880 Hz,
// a 1-s timeslice; its Info is 25 bytes at offset 48, after the 36-byte EBML header and the Segment's 12-byte header):
// the Duration written into Info, a block cut off at the end dropped, any other layout copied as it is.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { copyFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { finalizeWebm } from './webm-duration';

// As they are, unless a test makes one copy fail midway.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'recorded.webm'));
const INFO_AT = 48;
// Then, in the fixture: Info 48-78, Tracks 78-146, the first Cluster's header 146-158 and its Timecode 158-161, then
// SimpleBlocks of 486 bytes (3 of header) from 161: the first ends at 647, and one starts mid-file at 13 785.
const INFO = FIXTURE.subarray(INFO_AT, 78);
const TRACKS_END = 146;
const TIMECODE_AT = 158;
const FIRST_BLOCK_END = 647;
const MID_FILE_BLOCK_AT = 13_785;
/** The fixture with `bytes` put in at `at`. */
const withAt = (at: number, bytes: Buffer | number[]) => Buffer.concat([FIXTURE.subarray(0, at), Buffer.from(bytes), FIXTURE.subarray(at)]);
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('finalizeWebm', () => {
  let dir: string;
  let n = 0;
  const file = (body: Buffer) => {
    const path = join(dir, `in-${++n}.webm`);
    writeFileSync(path, body);
    return path;
  };
  const out = () => join(dir, `out-${++n}.webm`);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'webm-duration-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** The Duration in Info, in ms at the fixture's 1-ms TimecodeScale; null without one. */
  const durationIn = (webm: Buffer): number | null => {
    const at = webm.indexOf(Buffer.from([0x44, 0x89, 0x88]), INFO_AT);
    return at < 0 || at > INFO_AT + 64 ? null : webm.readDoubleBE(at + 3);
  };

  it('writes the Duration MediaRecorder leaves out: up to the last block, plus one more block of time', async () => {
    expect(durationIn(FIXTURE)).toBeNull();
    const dst = out();
    expect(await finalizeWebm(file(FIXTURE), dst)).toEqual({ durationMs: 3421, bytes: FIXTURE.length + 11, rewritten: true });
    expect(modeOf(dst)).toBe(0o600); // a recording: this server's user's alone
    const written = readFileSync(dst);
    expect(durationIn(written)).toBe(3421);
    expect(written[INFO_AT + 4]).toBe(0x80 | (25 + 11)); // Info grew by the Duration's 11 bytes
    // the rest is the recording, byte for byte
    expect(written.subarray(0, INFO_AT + 4).equals(FIXTURE.subarray(0, INFO_AT + 4))).toBe(true);
    expect(written.subarray(INFO_AT + 5 + 36).equals(FIXTURE.subarray(INFO_AT + 5 + 25))).toBe(true);
  });

  it('replaces a Duration already there, rather than adding a second', async () => {
    const once = out();
    await finalizeWebm(file(FIXTURE), once);
    const twice = out();
    expect((await finalizeWebm(once, twice)).durationMs).toBe(3421);
    expect(readFileSync(twice).equals(readFileSync(once))).toBe(true);
  });

  it('drops a block the file ends inside of (a crash in the middle of a write), and counts up to the last whole one', async () => {
    const cut = FIXTURE.subarray(0, FIXTURE.length - 150);
    const dst = out();
    const r = await finalizeWebm(file(cut), dst);
    expect(r.rewritten).toBe(true);
    expect(r.durationMs).toBeGreaterThan(3000);
    expect(r.durationMs).toBeLessThan(3421);
    expect(r.bytes).toBeLessThan(cut.length + 11);
    // what is left ends on a whole block: finalizing it again drops nothing more
    expect((await finalizeWebm(dst, out())).bytes).toBe(r.bytes);
  });

  it('cuts a file that ends inside a header there', async () => {
    const dst = out();
    expect(await finalizeWebm(file(FIXTURE.subarray(0, FIRST_BLOCK_END + 1)), dst)).toEqual({ durationMs: 20, bytes: FIRST_BLOCK_END + 11, rewritten: true });
    expect(readFileSync(dst).subarray(INFO_AT + 5 + 36).equals(FIXTURE.subarray(INFO_AT + 5 + 25, FIRST_BLOCK_END))).toBe(true);
  });

  it('a recording of one block lasts one Opus frame', async () => {
    expect(await finalizeWebm(file(FIXTURE.subarray(0, FIRST_BLOCK_END)), out())).toEqual({ durationMs: 20, bytes: FIRST_BLOCK_END + 11, rewritten: true });
  });

  it('reads through a window much smaller than the file, to the same copy', async () => {
    const src = file(FIXTURE);
    const big = out();
    const small = out();
    await finalizeWebm(src, big);
    expect(await finalizeWebm(src, small, { windowBytes: 100 })).toEqual({ durationMs: 3421, bytes: FIXTURE.length + 11, rewritten: true });
    expect(readFileSync(small).equals(readFileSync(big))).toBe(true);
  });

  // The Segment's 8-byte size (offsets 40-47) set to a known value: it would have to grow with Info.
  const knownSize = Buffer.from(FIXTURE);
  knownSize.fill(0, 41, 44);
  knownSize.writeUInt32BE(FIXTURE.length - 48, 44);
  // A copy as it is never loses a byte: anything but MediaRecorder's own layout, and anything but a clean cut end.
  it.each<[string, Buffer, number?]>([
    ['a Segment of known size (it would have to grow with Info)', knownSize],
    ['Cues (they point at byte offsets the 11 bytes would shift)', Buffer.concat([FIXTURE, Buffer.from([0x1c, 0x53, 0xbb, 0x6b, 0x80])])],
    ['a SeekHead (byte offsets too)', withAt(INFO_AT, [0x11, 0x4d, 0x9b, 0x74, 0x80])],
    ['a Cluster Position (a byte offset too)', withAt(TIMECODE_AT + 3, [0xa7, 0x81, 0x00])],
    ['a BlockGroup (MediaRecorder writes none)', Buffer.concat([FIXTURE, Buffer.from([0xa0, 0x80])])],
    ['a second Info', withAt(INFO_AT + INFO.length, INFO)],
    ['an Info after the first Cluster', Buffer.concat([FIXTURE.subarray(0, INFO_AT), FIXTURE.subarray(INFO_AT + INFO.length), INFO])],
    ['an Info larger than the window it is read through', FIXTURE, 24],
    ['a Timecode larger than 8 bytes', Buffer.concat([FIXTURE.subarray(0, TIMECODE_AT), Buffer.from([0xe7, 0x89, ...Array(9).fill(0)]), FIXTURE.subarray(TIMECODE_AT + 3)])],
    ['a byte mid-file that is no header (not the end of the file)', withAt(MID_FILE_BLOCK_AT, [0x00])],
    ['a last SimpleBlock shorter than its own head', Buffer.concat([FIXTURE, Buffer.from([0xa3, 0x81, 0x81])])],
    ['no block at all (cut right after Tracks)', FIXTURE.subarray(0, TRACKS_END)],
    ['not a WebM at all', Buffer.from('not a recording')],
  ])('copies as it is: %s', async (_what, body, windowBytes) => {
    const dst = out();
    expect(await finalizeWebm(file(body), dst, { windowBytes })).toEqual({ durationMs: 0, bytes: body.length, rewritten: false });
    expect(readFileSync(dst).equals(body)).toBe(true);
    expect(modeOf(dst)).toBe(0o600); // copied from a file of 0644
  });

  // A disk that fills up, or a read that fails: the caller keeps its own file and tries again, and finds no half copy.
  it.each([
    ['with the Duration', FIXTURE, () => vi.mocked(createReadStream).mockImplementationOnce((() => new Readable({ read() { this.destroy(new Error('EIO: i/o error, read')); } })) as never)],
    ['as it is', Buffer.from('not a recording'), () => vi.mocked(copyFile).mockImplementationOnce(async (_from, to) => {
      writeFileSync(String(to), 'half');
      throw new Error('ENOSPC: no space left on device, copyfile');
    })],
  ])('a copy %s that fails midway leaves nothing behind', async (_what, body, failMidway) => {
    const dst = out();
    failMidway();
    await expect(finalizeWebm(file(body), dst)).rejects.toThrow(/EIO|ENOSPC/);
    expect(existsSync(dst)).toBe(false);
  });
});

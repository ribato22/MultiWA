// finalizeWebm on a recording Chrome's MediaRecorder made (fixtures/recorded.webm: 3.42 s, left 440 Hz, right 880 Hz,
// a 1-s timeslice; its Info is 25 bytes at offset 48, after the 36-byte EBML header and the Segment's 12-byte header):
// the Duration written into Info, a block cut off at the end dropped, any other layout copied as it is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { finalizeWebm } from './webm-duration';

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'recorded.webm'));
const INFO_AT = 48;

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

  it('reads through a window much smaller than the file, to the same copy', async () => {
    const src = file(FIXTURE);
    const big = out();
    const small = out();
    await finalizeWebm(src, big);
    expect(await finalizeWebm(src, small, { windowBytes: 100 })).toEqual({ durationMs: 3421, bytes: FIXTURE.length + 11, rewritten: true });
    expect(readFileSync(small).equals(readFileSync(big))).toBe(true);
  });

  it('copies any other layout as it is: a Segment of known size, Cues, not a WebM at all', async () => {
    // The Segment's 8-byte size (offsets 40-47) set to a known value: it would have to grow with Info.
    const known = Buffer.from(FIXTURE);
    known.fill(0, 41, 44);
    known.writeUInt32BE(FIXTURE.length - 48, 44);
    // Cues point at byte offsets the 11 bytes would shift.
    const cues = Buffer.concat([FIXTURE, Buffer.from([0x1c, 0x53, 0xbb, 0x6b, 0x80])]);
    for (const body of [known, cues, Buffer.from('not a recording')]) {
      const dst = out();
      expect(await finalizeWebm(file(body), dst)).toEqual({ durationMs: 0, bytes: body.length, rewritten: false });
      expect(readFileSync(dst).equals(body)).toBe(true);
    }
  });
});

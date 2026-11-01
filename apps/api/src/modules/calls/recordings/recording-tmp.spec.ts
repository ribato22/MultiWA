// A recording's files in tmpDir: its state written whole (aside, then renamed) and read back; which calls left files
// there, and when last; every file of a call deleted, and nothing else.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { leftovers, readState, removeFiles, tmpFiles, writeState } from './recording-tmp';

const A = '33333333-3333-4333-8333-333333333333';
const B = '55555555-5555-4555-8555-555555555555';

describe('recording-tmp', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recording-tmp-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("names a call's files by its id", () => {
    expect(tmpFiles(dir, A)).toEqual({ recording: join(dir, `${A}.webm`), state: join(dir, `${A}.json`), final: join(dir, `${A}.final.webm`) });
  });

  it('writes the state whole and reads it back; a missing or unreadable one is none', async () => {
    expect(await readState(dir, A)).toBeNull();
    await writeState(dir, A, { announced: false, stopped: false });
    await writeState(dir, A, { announced: true, stopped: false });
    expect(await readState(dir, A)).toEqual({ announced: true, stopped: false });
    expect(readdirSync(dir)).toEqual([`${A}.json`]); // no .part left behind
    writeFileSync(tmpFiles(dir, B).state, '{"announced": tr');
    expect(await readState(dir, B)).toBeNull();
  });

  it('lists each call with files here, with its newest file time; names of other shapes are not its own', async () => {
    writeFileSync(tmpFiles(dir, A).recording, 'x');
    writeFileSync(tmpFiles(dir, A).state, '{}');
    utimesSync(tmpFiles(dir, A).recording, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
    utimesSync(tmpFiles(dir, A).state, new Date('2026-10-02T00:00:00Z'), new Date('2026-10-02T00:00:00Z'));
    writeFileSync(join(dir, `${B}.json.1a2b3c4d.part`), '{}'); // a state write a crash cut short
    writeFileSync(join(dir, 'notes.txt'), 'not ours');
    writeFileSync(join(dir, 'ABCDEF00-0000-4000-8000-000000000000.webm'), 'not a calls id: upper case');
    const found = (await leftovers(dir)).sort((x, y) => x.callId.localeCompare(y.callId));
    expect(found.map((f) => f.callId)).toEqual([A, B]);
    expect(found[0].modifiedAt.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('deletes every file of a call (its recording, state, final copy and unfinished state writes), and only its', async () => {
    for (const path of Object.values(tmpFiles(dir, A))) writeFileSync(path, 'x');
    writeFileSync(join(dir, `${A}.json.1a2b3c4d.part`), 'x');
    writeFileSync(tmpFiles(dir, B).recording, 'x');
    await removeFiles(dir, A);
    expect(readdirSync(dir)).toEqual([`${B}.webm`]);
    await removeFiles(dir, A); // nothing left: fine
  });
});

// A recordings store in memory, for the specs: its files (bytes and times) can be set and read back; spy on its
// methods with vi.spyOn. Not a spec, and outside src/modules, so neither vitest nor the coverage gate counts it.
import { readFile } from 'fs/promises';
import { Readable } from 'stream';
import type { PrivacyCheck, RecordingStore, StoredObject } from '../modules/calls/recordings/recording-store';

export class MemoryRecordingStore implements RecordingStore {
  problem: string | null = null;
  /**
   * A directory the spec makes (mkdtemp): the recorder's files go there. Unlike a real store's, it starts '' with
   * `tmpProblem` null: it is for the specs that set it themselves.
   */
  tmpDir = '';
  /** Set: recordings cannot be made here (as with CALL_RECORDINGS_TMP missing), and what is stored stays reachable. */
  tmpProblem: string | null = null;
  /** What checkPrivate answers. */
  privacy: PrivacyCheck = { ok: true };
  readonly files = new Map<string, { body: Buffer; lastModified: Date }>();

  constructor(
    readonly type: 'local' | 's3' = 'local',
    readonly location = 'memory:test',
  ) {}

  /** Sets a file directly, with its time. */
  file(key: string, body: string | Buffer = 'x', lastModified = new Date()): void {
    this.files.set(key, { body: Buffer.from(body), lastModified });
  }

  async put(key: string, body: Buffer, _mimeType?: string): Promise<void> {
    this.files.set(key, { body, lastModified: new Date() });
  }

  async putFile(key: string, path: string, _mimeType?: string): Promise<void> {
    this.files.set(key, { body: await readFile(path), lastModified: new Date() });
  }

  async size(key: string): Promise<number | null> {
    return this.files.get(key)?.body.length ?? null;
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const file = this.files.get(key);
    if (!file) throw Object.assign(new Error(`ENOENT: no such file, open '${key}'`), { code: 'ENOENT' });
    return Readable.from([range ? file.body.subarray(range.start, range.end + 1) : file.body]);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async *list(): AsyncIterable<StoredObject> {
    for (const [key, f] of this.files) yield { key, size: f.body.length, lastModified: f.lastModified };
  }

  async checkPrivate(): Promise<PrivacyCheck> {
    return this.privacy;
  }
}

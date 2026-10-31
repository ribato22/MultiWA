// A recordings store in memory, for the specs: its files (bytes and times) can be set and read back; spy on its
// methods with vi.spyOn. Not a spec, and outside src/modules, so neither vitest nor the coverage gate counts it.
import { Readable } from 'stream';
import type { PrivacyCheck, RecordingStore, StoredObject } from '../modules/calls/recordings/recording-store';

export class MemoryRecordingStore implements RecordingStore {
  problem: string | null = null;
  /** What checkPrivate answers. */
  privacy: PrivacyCheck = { ok: true };
  readonly files = new Map<string, { body: Buffer; lastModified: Date }>();

  constructor(
    readonly type: 'local' | 's3' = 'local',
    readonly location = 'memory:test',
  ) {}

  /** Sets a file directly, with its time. */
  file(key: string, body = 'x', lastModified = new Date()): void {
    this.files.set(key, { body: Buffer.from(body), lastModified });
  }

  async put(key: string, body: Buffer, _mimeType?: string): Promise<void> {
    this.files.set(key, { body, lastModified: new Date() });
  }

  async size(key: string): Promise<number | null> {
    return this.files.get(key)?.body.length ?? null;
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const body = this.files.get(key)!.body;
    return Readable.from([range ? body.subarray(range.start, range.end + 1) : body]);
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

// MultiWA Gateway - a recording's files while its call lasts, and after a crash
// apps/api/src/modules/calls/recordings/recording-tmp.ts
//
// In the store's tmpDir, per call (its calls row id, a lowercase uuid):
//   <callId>.webm        the recording, appended chunk by chunk as the page sends them
//   <callId>.json        what is known of it: { announced, stopped }, written whole (aside, then renamed)
//   <callId>.final.webm  the copy with its length written in, while it is being stored
// The state is written FIRST, so a recording never lacks one; a crash leaves both, and the next boot (or the nightly
// job) finishes them: discarded when the announcement had not played, stored as partial when not stopped cleanly.
// Only names of these shapes are ever touched: the directory may hold anything else.
import { randomBytes } from 'crypto';
import { readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';

export interface RecordingState {
  /** The caller heard the whole announcement: without it a recording is never kept. */
  announced: boolean;
  /** Its recorder stopped and gave its last chunks: otherwise what was written is all there is (partial). */
  stopped: boolean;
}

const OWN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(webm|json|final\.webm|json\.[0-9a-f]{8}\.part)$/;
/** The call a file of these shapes belongs to; undefined for any other name. */
const callOf = (name: string) => name.match(OWN)?.[1];

export const tmpFiles = (dir: string, callId: string) => ({
  recording: join(dir, `${callId}.webm`),
  state: join(dir, `${callId}.json`),
  final: join(dir, `${callId}.final.webm`),
});

export async function writeState(dir: string, callId: string, state: RecordingState): Promise<void> {
  const path = tmpFiles(dir, callId).state;
  const part = `${path}.${randomBytes(4).toString('hex')}.part`;
  await writeFile(part, JSON.stringify(state), { mode: 0o600 });
  await rename(part, path);
}

/** Null when there is none, or it cannot be read: a recording without a state is never kept. */
export async function readState(dir: string, callId: string): Promise<RecordingState | null> {
  try {
    const raw = JSON.parse(await readFile(tmpFiles(dir, callId).state, 'utf8'));
    return { announced: raw?.announced === true, stopped: raw?.stopped === true };
  } catch {
    return null;
  }
}

/** Each call with files here, and the time of its newest one. */
export async function leftovers(dir: string): Promise<Array<{ callId: string; modifiedAt: Date }>> {
  const newest = new Map<string, number>();
  for (const name of await readdir(dir)) {
    const callId = callOf(name);
    if (!callId) continue;
    const at = await stat(join(dir, name)).then((s) => s.mtimeMs, () => null);
    if (at !== null) newest.set(callId, Math.max(at, newest.get(callId) ?? 0));
  }
  return [...newest].map(([callId, at]) => ({ callId, modifiedAt: new Date(at) }));
}

/** Every file of the call: its recording, its state, its final copy, and its unfinished state writes. */
export async function removeFiles(dir: string, callId: string): Promise<void> {
  const names = (await readdir(dir)).filter((name) => callOf(name) === callId);
  await Promise.all(names.map((name) => rm(join(dir, name), { force: true })));
}

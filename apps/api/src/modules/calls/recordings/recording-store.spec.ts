// The private store of call recordings on a local directory: keys of its own shapes only (the sweep deletes nothing
// else), never outside its root, written whole or not at all, ranges read as asked. And the settings that make a
// store: a directory of its own, or a store that says what is wrong.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  LocalRecordingStore, UnsetRecordingStore, announcementKey, createRecordingStore, isAnnouncementOf, isStoreKey, recordingKey,
} from './recording-store';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const CALL = '33333333-3333-4333-8333-333333333333';
const text = async (stream: AsyncIterable<unknown>) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks).toString();
};

describe('recording store keys', () => {
  it('a recording: organization, profile, the month of the call (UTC), the call', () => {
    expect(recordingKey(ORG, PROFILE, CALL, new Date('2026-01-31T23:30:00Z'))).toBe(`${ORG}/${PROFILE}/2026/01/${CALL}.webm`);
  });

  it("an announcement: under announcements/, the profile's own", () => {
    const key = announcementKey(ORG, PROFILE, 'mp3');
    expect(key).toMatch(new RegExp(`^announcements/${ORG}/${PROFILE}/[0-9a-f-]{36}\\.mp3$`));
    expect(isAnnouncementOf(key, PROFILE)).toBe(true);
    expect(isAnnouncementOf(key, CALL)).toBe(false);
    expect(isAnnouncementOf(announcementKey(ORG, CALL, 'mp3'), PROFILE)).toBe(false); // another profile's
    expect(isAnnouncementOf(`announcements/${ORG}/${PROFILE}/x/../${CALL}.mp3`, PROFILE)).toBe(false);
    expect(isAnnouncementOf(`${ORG}/${PROFILE}/2026/01/${CALL}.webm`, PROFILE)).toBe(false);
  });

  it('the store owns only its own shapes, and their unfinished writes', () => {
    for (const key of [recordingKey(ORG, PROFILE, CALL, new Date()), announcementKey(ORG, PROFILE, 'ogg'), `probe/${CALL}`]) {
      expect(isStoreKey(key)).toBe(true);
      expect(isStoreKey(`${key}.0a1b2c3d.part`)).toBe(true);
      expect(isStoreKey(`${key}.part`)).toBe(false);
    }
    for (const key of [
      'media/3f2504e0-4f89-41d3-9a0c-0305e82c3301.png', 'notes.txt', `${ORG}/${PROFILE}/${CALL}.webm`,
      `announcements/${ORG}/${PROFILE}/${CALL}.exe`, `probe/${CALL}/x`, `../${ORG}/${PROFILE}/2026/01/${CALL}.webm`,
    ]) {
      expect(isStoreKey(key)).toBe(false);
    }
  });
});

describe('LocalRecordingStore', () => {
  let root: string;
  let store: LocalRecordingStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rec-store-'));
    store = new LocalRecordingStore(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts, sizes, reads whole and in ranges, deletes; a missing object has no size and deletes fine', async () => {
    const key = recordingKey(ORG, PROFILE, CALL, new Date('2026-10-31T00:00:00Z'));
    await store.put(key, Buffer.from('0123456789'), 'audio/webm');
    expect(existsSync(join(root, ORG, PROFILE, '2026', '10', `${CALL}.webm`))).toBe(true);
    expect(statSync(join(root, ORG)).mode & 0o777).toBe(0o700);
    expect(await store.size(key)).toBe(10);
    expect(await text(await store.read(key))).toBe('0123456789');
    expect(await text(await store.read(key, { start: 2, end: 4 }))).toBe('234');
    await store.delete(key);
    expect(await store.size(key)).toBeNull();
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it('leaves no unfinished file behind a put', async () => {
    const key = announcementKey(ORG, PROFILE, 'mp3');
    await store.put(key, Buffer.from('x'), 'audio/mpeg');
    expect(readdirSync(join(root, 'announcements', ORG, PROFILE))).toEqual([key.split('/').pop()]);
  });

  it('two puts of one key at once: the key ends with one of the two bodies, whole', async () => {
    const key = recordingKey(ORG, PROFILE, CALL, new Date('2026-10-31T00:00:00Z'));
    // Larger than one write: two writers of one file would interleave their chunks.
    const a = Buffer.alloc(3 << 20, 'a');
    const b = Buffer.alloc(1 << 20, 'b');
    await Promise.all([store.put(key, a, 'audio/webm'), store.put(key, b, 'audio/webm')]);
    const body = readFileSync(join(root, ORG, PROFILE, '2026', '10', `${CALL}.webm`));
    expect(body.equals(a) || body.equals(b)).toBe(true);
    expect(readdirSync(join(root, ORG, PROFILE, '2026', '10'))).toEqual([`${CALL}.webm`]);
  });

  it('a missing object rejects a read with ENOENT, before any stream exists', async () => {
    await expect(store.read(`probe/${CALL}`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.read(`probe/${CALL}`, { start: 0, end: 1 })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never reaches outside its root', async () => {
    for (const key of ['../escape', 'a/../../escape', '..', './']) {
      await expect(store.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow('Not a storage key');
    }
    expect(existsSync(join(root, '..', 'escape'))).toBe(false);
  });

  it('lists every file with its key, size and time', async () => {
    const a = recordingKey(ORG, PROFILE, CALL, new Date('2026-10-31T00:00:00Z'));
    const b = `probe/${CALL}`;
    await store.put(a, Buffer.from('abc'), 'audio/webm');
    await store.put(b, Buffer.from('probe'), 'text/plain');
    const listed = [];
    for await (const o of store.list()) listed.push(o);
    expect(listed.map((o) => `${o.key}:${o.size}`).sort()).toEqual([`${a}:3`, `${b}:5`].sort());
    expect(listed.every((o) => o.lastModified instanceof Date)).toBe(true);
  });

  it('the privacy check: a probe written, read back and deleted', async () => {
    expect(await store.checkPrivate()).toEqual({ ok: true });
    const left = [];
    for await (const o of store.list()) left.push(o);
    expect(left).toEqual([]);
  });

  it('the privacy check fails when the directory cannot be written', async () => {
    writeFileSync(join(root, 'a-file'), 'x');
    const broken = new LocalRecordingStore(join(root, 'a-file'));
    expect(await broken.checkPrivate()).toMatchObject({ ok: false, reason: 'storage_check_failed' });
  });

  it('stores a file under its key: copied aside, then renamed into place; the file itself stays', async () => {
    const src = join(root, 'a.webm');
    writeFileSync(src, 'a recording');
    const withTmp = new LocalRecordingStore(root, { dir: '/x' });
    await withTmp.putFile('o/p/2026/10/c.webm', src, 'audio/webm');
    expect(readFileSync(join(root, 'o/p/2026/10/c.webm'), 'utf8')).toBe('a recording');
    expect(readdirSync(join(root, 'o/p/2026/10'))).toEqual(['c.webm']); // no .part left behind
    expect(statSync(join(root, 'o')).mode & 0o777).toBe(0o700);
    expect(readFileSync(src, 'utf8')).toBe('a recording');
    expect(withTmp).toMatchObject({ tmpDir: '/x', tmpProblem: null });
  });
});

describe('createRecordingStore: local', () => {
  const dirs: string[] = [];
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'rec-env-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('the directory CALL_RECORDINGS_PATH names, created when missing', () => {
    const root = join(dir(), 'recordings');
    const store = createRecordingStore({ CALL_RECORDINGS_PATH: root });
    expect(store).toBeInstanceOf(LocalRecordingStore);
    expect(store).toMatchObject({ type: 'local', problem: null, location: `local:${root}` });
    expect(existsSync(root)).toBe(true);
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it.each([
    [{}, 'CALL_RECORDINGS_PATH is not set'],
    [{ CALL_RECORDINGS_PATH: '  ' }, 'CALL_RECORDINGS_PATH is not set'],
    [{ CALL_RECORDINGS_STORAGE: 'ftp' }, 'CALL_RECORDINGS_STORAGE must be local or s3'],
    [{ STORAGE_TYPE: 'ftp' }, 'STORAGE_TYPE must be local or s3'],
  ])('a store that says what is wrong: %j', (env, problem) => {
    const store = createRecordingStore(env);
    expect(store).toBeInstanceOf(UnsetRecordingStore);
    expect(store.problem).toContain(problem);
    expect(store.location).toBe('');
  });

  // The media folder is served without a login, the sessions volume is snapshotted with every session, and a root
  // around the application would be walked whole by the nightly sweep. The working-directory cases name a media and a
  // sessions directory elsewhere, so that the working-directory rule is the one that refuses.
  it.each([
    ['inside STORAGE_PATH', (d: string) => ({ STORAGE_PATH: d, CALL_RECORDINGS_PATH: join(d, 'rec') })],
    ['around STORAGE_PATH', (d: string) => ({ STORAGE_PATH: join(d, 'media'), CALL_RECORDINGS_PATH: d })],
    ['inside SESSIONS_DIR', (d: string) => ({ SESSIONS_DIR: d, CALL_RECORDINGS_PATH: join(d, 'rec') })],
    ['around SESSIONS_DIR', (d: string) => ({ SESSIONS_DIR: join(d, 'sessions'), CALL_RECORDINGS_PATH: d })],
    ['the working directory', (d: string) => ({ STORAGE_PATH: d, SESSIONS_DIR: d, CALL_RECORDINGS_PATH: process.cwd() })],
    ['around the working directory', (d: string) => ({ STORAGE_PATH: d, SESSIONS_DIR: d, CALL_RECORDINGS_PATH: resolve(process.cwd(), '..') })],
  ])('refuses a directory %s', (_what, envOf) => {
    expect(createRecordingStore(envOf(dir())).problem).toMatch(/a directory of its own/);
  });

  // Without SESSIONS_DIR the engines keep their sessions in /data/sessions or ./sessions (EngineManagerService).
  it.each([
    ['inside /data/sessions', () => '/data/sessions/rec'],
    ['around /data/sessions', () => '/data'],
    ['inside ./sessions', (d: string) => join(d, 'sessions', 'rec')],
  ])('SESSIONS_DIR unset: refuses a directory %s', (_what, pathOf) => {
    const d = dir();
    vi.spyOn(process, 'cwd').mockReturnValue(d); // ./sessions is <d>/sessions
    expect(createRecordingStore({ STORAGE_PATH: join(d, 'media'), CALL_RECORDINGS_PATH: pathOf(d) }).problem).toMatch(
      /a directory of its own, not inside or around SESSIONS_DIR/,
    );
  });

  it('a directory for recordings in progress: CALL_RECORDINGS_TMP, created when missing', () => {
    const tmp = join(dir(), 'in-progress');
    expect(createRecordingStore({ CALL_RECORDINGS_PATH: join(dir(), 'recordings'), CALL_RECORDINGS_TMP: tmp })).toMatchObject({ tmpDir: tmp, tmpProblem: null });
    expect(existsSync(tmp)).toBe(true);
    expect(statSync(tmp).mode & 0o777).toBe(0o700);
  });

  // No default in the system's temp directory: another local user could take it there, a reboot loses it where /tmp is
  // in RAM, and two installations on one host would share it.
  it('CALL_RECORDINGS_TMP unset: recording cannot be made here, and the store still works', async () => {
    const root = join(dir(), 'recordings');
    const store = createRecordingStore({ CALL_RECORDINGS_PATH: root });
    expect(store).toBeInstanceOf(LocalRecordingStore);
    expect(store).toMatchObject({ problem: null, location: `local:${root}`, tmpDir: '', tmpProblem: 'CALL_RECORDINGS_TMP is not set' });
    expect(await store.checkPrivate()).toEqual({ ok: true });
  });

  // Recordings in progress are recordings: under the media they would be served without a login, under the sessions
  // they would be in every sessions backup, and inside the recordings directory the nightly sweep would walk them.
  it.each([
    ['STORAGE_PATH', (d: string) => ({ STORAGE_PATH: join(d, 'media'), CALL_RECORDINGS_TMP: join(d, 'media', 'tmp') })],
    ['SESSIONS_DIR', (d: string) => ({ SESSIONS_DIR: join(d, 'sessions'), CALL_RECORDINGS_TMP: join(d, 'sessions', 'call-recordings-tmp') })],
    ['CALL_RECORDINGS_PATH', (d: string) => ({ CALL_RECORDINGS_TMP: join(d, 'recordings', 'tmp') })],
    ['CALL_RECORDINGS_PATH', (d: string) => ({ CALL_RECORDINGS_TMP: d })],
  ])('refuses a directory for recordings in progress inside or around %s: recording only, what is stored stays reachable', (name, env) => {
    const d = dir();
    const store = createRecordingStore({ CALL_RECORDINGS_PATH: join(d, 'recordings'), ...env(d) });
    expect(store).toBeInstanceOf(LocalRecordingStore);
    expect(store).toMatchObject({
      problem: null, location: `local:${join(d, 'recordings')}`, tmpDir: '',
      tmpProblem: `CALL_RECORDINGS_TMP must be a directory of its own, not inside or around ${name}`,
    });
  });

  // Recordings are personal data: both their directories are this server's user's alone. CALL_RECORDINGS_TMP is checked
  // on S3, where it is the only directory: on a local store CALL_RECORDINGS_PATH, checked first, would answer for it.
  const problemOf = {
    CALL_RECORDINGS_PATH: (d: string) => createRecordingStore({ CALL_RECORDINGS_PATH: d, CALL_RECORDINGS_TMP: join(dir(), 'tmp') }).problem,
    CALL_RECORDINGS_TMP: (d: string) =>
      createRecordingStore(
        { CALL_RECORDINGS_STORAGE: 's3', S3_ENDPOINT: 'http://minio:9000', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b', S3_BUCKET: 'media', CALL_RECORDINGS_TMP: d },
        () => ({ send: async () => ({}) }),
      ).tmpProblem,
  };
  const SETTINGS = Object.keys(problemOf) as Array<keyof typeof problemOf>;
  const notAlone = (name: string) => `${name} must be a directory of this server's user alone`;

  it.each(SETTINGS)('%s: a directory others may read (a Docker volume: root, 0755) is made 0700', (name) => {
    const d = dir();
    chmodSync(d, 0o755);
    expect(problemOf[name](d)).toBeNull();
    expect(statSync(d).mode & 0o7777).toBe(0o700);
  });

  it.each(SETTINGS)('%s: refused when another user owns it', (name) => {
    const d = dir();
    const uid = process.getuid!();
    vi.spyOn(process as Required<NodeJS.Process>, 'getuid').mockReturnValue(uid + 1);
    expect(problemOf[name](d)).toBe(notAlone(name));
  });

  it.each(SETTINGS)('%s: refused when shared (the sticky bit, as on /tmp)', (name) => {
    const d = dir();
    chmodSync(d, 0o1777);
    expect(problemOf[name](d)).toBe(notAlone(name));
  });

  it.each(SETTINGS)('%s: refused when a symlink, even to a directory of its own', (name) => {
    const link = join(dir(), 'link');
    symlinkSync(dir(), link);
    expect(problemOf[name](link)).toBe(notAlone(name));
  });

  it.each(SETTINGS)('%s: a directory that cannot be created says so', (name) => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const d = dir();
    writeFileSync(join(d, 'a-file'), 'x');
    expect(problemOf[name](join(d, 'a-file', 'x'))).toBe(`${name} cannot be created (the server log says why)`);
  });
});

// GET /calls/media/status shows a store's problem to the owners and admins of every organization, and one storage
// serves them all: a problem names settings, never what they are set to (a path, an address, a bucket, a key).
describe('createRecordingStore: a problem names settings, never their values', () => {
  const MARK = 'q7z';
  const S3 = {
    CALL_RECORDINGS_STORAGE: 's3', S3_ENDPOINT: `https://${MARK}.example.com`, S3_ACCESS_KEY: `${MARK}-access`, S3_SECRET_KEY: `${MARK}-secret`,
    CALL_RECORDINGS_BUCKET: `${MARK}-bucket`,
  };
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), `rec-${MARK}-`));
    writeFileSync(join(root, 'a-file'), 'x');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  it.each<[string, (d: string) => NodeJS.ProcessEnv]>([
    ['S3 settings missing', () => ({ ...S3, S3_SECRET_KEY: '' })],
    ['an SSE of another kind', () => ({ ...S3, CALL_RECORDINGS_SSE: MARK })],
    ['a prefix of unsafe characters', () => ({ ...S3, CALL_RECORDINGS_PREFIX: `${MARK}#1` })],
    ['a path where the storage type goes', () => ({ CALL_RECORDINGS_STORAGE: `/data/${MARK}` })],
    ['a directory inside STORAGE_PATH', (d) => ({ STORAGE_PATH: join(d, 'media'), CALL_RECORDINGS_PATH: join(d, 'media', 'rec') })],
    ['a directory around SESSIONS_DIR', (d) => ({ SESSIONS_DIR: join(d, 'wa'), CALL_RECORDINGS_PATH: d })],
    ['a directory that cannot be created', (d) => ({ CALL_RECORDINGS_PATH: join(d, 'a-file', 'rec') })],
  ])('%s', (_what, envOf) => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { problem } = createRecordingStore(envOf(root));
    expect(problem).toEqual(expect.any(String));
    expect(problem).not.toContain(MARK);
  });

  it('a directory that cannot be created: the server log says why, and where', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const path = join(root, 'a-file', 'rec');
    expect(createRecordingStore({ CALL_RECORDINGS_PATH: path }).problem).toBe('CALL_RECORDINGS_PATH cannot be created (the server log says why)');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(path);
    expect(warn.mock.calls[0][0]).toContain('ENOTDIR');
  });
});

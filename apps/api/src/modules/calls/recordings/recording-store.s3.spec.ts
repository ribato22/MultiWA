// The S3 store of call recordings: every object private (no ACL; server-side encryption when asked), keys under the
// prefix, Range reads, a paged listing. And its privacy check, which fetches a probe WITHOUT credentials through the
// endpoint and S3_PUBLIC_URL. The client and fetch are stand-ins.
import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { LocalRecordingStore, S3RecordingStore, createRecordingStore } from './recording-store';

const CONFIG = { bucket: 'recs', prefix: 'call-recordings/', publicBases: ['http://minio:9000'] };
const client = (reply: (command: any) => unknown = () => ({})) => ({ send: vi.fn(async (command: any) => reply(command)) });
const sent = (s3: ReturnType<typeof client>) => s3.send.mock.calls.map(([c]) => [c.constructor, c.input]);

describe('S3RecordingStore', () => {
  it('puts privately: no ACL, under the prefix, with its type; SSE when configured', async () => {
    const s3 = client();
    await new S3RecordingStore(s3, CONFIG).put('probe/x', Buffer.from('a'), 'text/plain');
    await new S3RecordingStore(s3, { ...CONFIG, sse: 'aws:kms' }).put('probe/y', Buffer.from('b'), 'text/plain');
    expect(sent(s3)).toEqual([
      [PutObjectCommand, { Bucket: 'recs', Key: 'call-recordings/probe/x', Body: Buffer.from('a'), ContentType: 'text/plain' }],
      [PutObjectCommand, { Bucket: 'recs', Key: 'call-recordings/probe/y', Body: Buffer.from('b'), ContentType: 'text/plain', ServerSideEncryption: 'aws:kms' }],
    ]);
  });

  it('sizes by HEAD; a 404 is no object, another error is thrown', async () => {
    const failing = (status: number) => Object.assign(new Error(`status ${status}`), { $metadata: { httpStatusCode: status } });
    const store = (e?: Error) => new S3RecordingStore(client(() => { if (e) throw e; return { ContentLength: 42 }; }), CONFIG);
    expect(await store().size('k')).toBe(42);
    expect(await store(failing(404)).size('k')).toBeNull();
    await expect(store(failing(403)).size('k')).rejects.toThrow('status 403');
    const s3 = client(() => ({ ContentLength: 1 }));
    await new S3RecordingStore(s3, CONFIG).size('a/b');
    expect(sent(s3)).toEqual([[HeadObjectCommand, { Bucket: 'recs', Key: 'call-recordings/a/b' }]]);
  });

  it('reads a range as S3 Range bytes, the whole object without one', async () => {
    const s3 = client(() => ({ Body: Readable.from(['x']) }));
    const store = new S3RecordingStore(s3, CONFIG);
    await store.read('a/b.webm', { start: 5, end: 9 });
    await store.read('a/b.webm');
    expect(sent(s3)).toEqual([
      [GetObjectCommand, { Bucket: 'recs', Key: 'call-recordings/a/b.webm', Range: 'bytes=5-9' }],
      [GetObjectCommand, { Bucket: 'recs', Key: 'call-recordings/a/b.webm' }],
    ]);
  });

  it('lists every page under the prefix, with keys relative to it', async () => {
    const at = new Date('2026-10-01T00:00:00Z');
    const pages = [
      { Contents: [{ Key: 'call-recordings/probe/a', Size: 1, LastModified: at }], IsTruncated: true, NextContinuationToken: 't2' },
      { Contents: [{ Key: 'call-recordings/b', Size: 2, LastModified: at }], IsTruncated: false },
    ];
    const s3 = client(() => pages.shift());
    const listed = [];
    for await (const o of new S3RecordingStore(s3, CONFIG).list()) listed.push(o);
    expect(listed).toEqual([{ key: 'probe/a', size: 1, lastModified: at }, { key: 'b', size: 2, lastModified: at }]);
    expect(sent(s3)).toEqual([
      [ListObjectsV2Command, { Bucket: 'recs', Prefix: 'call-recordings/', ContinuationToken: undefined }],
      [ListObjectsV2Command, { Bucket: 'recs', Prefix: 'call-recordings/', ContinuationToken: 't2' }],
    ]);
  });

  it('deletes under the prefix', async () => {
    const s3 = client();
    await new S3RecordingStore(s3, CONFIG).delete('a/b.webm');
    expect(sent(s3)).toEqual([[DeleteObjectCommand, { Bucket: 'recs', Key: 'call-recordings/a/b.webm' }]]);
  });
});

describe('S3RecordingStore.checkPrivate', () => {
  const BASES = ['http://minio:9000', 'https://cdn.example.com'];
  // A stand-in S3 that keeps the probe's bytes, and a fetch that answers per address.
  function setup(answer: (url: string, probe: string) => Response) {
    let probe = '';
    const s3 = client((c) => {
      if (c instanceof PutObjectCommand) probe = String(c.input.Body);
      return {};
    });
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => answer(url, probe));
    return { s3, fetchFn, store: new S3RecordingStore(s3, { ...CONFIG, publicBases: BASES }, fetchFn as any) };
  }

  it('passes when every address refuses: the probe fetched without credentials at each, then deleted', async () => {
    const { s3, fetchFn, store } = setup(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    expect(await store.checkPrivate()).toEqual({ ok: true });
    const key = sent(s3)[0][1].Key;
    expect(key).toMatch(/^call-recordings\/probe\/[0-9a-f-]{36}$/);
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([`http://minio:9000/recs/${key}`, `https://cdn.example.com/recs/${key}`]);
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'follow' });
    expect(fetchFn.mock.calls[0][1]).not.toHaveProperty('headers'); // no credentials of any kind
    expect(sent(s3).pop()).toEqual([DeleteObjectCommand, { Bucket: 'recs', Key: key }]);
  });

  it.each([400, 401, 404])('a %i passes too: a refusal', async (status) => {
    expect(await setup(() => new Response('', { status })).store.checkPrivate()).toEqual({ ok: true });
  });

  it('a 2xx that is not the probe (a login page in front) is not the object: passes', async () => {
    expect(await setup(() => new Response('<html>Sign in</html>', { status: 200 })).store.checkPrivate()).toEqual({ ok: true });
  });

  it('not private when an address serves the probe itself; the probe is deleted all the same', async () => {
    const { s3, store } = setup((url, probe) => (url.startsWith('https://cdn') ? new Response(probe, { status: 200 }) : new Response('', { status: 403 })));
    expect(await store.checkPrivate()).toEqual({
      ok: false, reason: 'storage_not_private', detail: expect.stringContaining('https://cdn.example.com/recs/call-recordings/probe/'),
    });
    expect(sent(s3).pop()?.[0]).toBe(DeleteObjectCommand);
  });

  it.each([
    ['an error status', () => new Response('', { status: 503 }), 'answered 503'],
    ['no answer', () => { throw new TypeError('fetch failed'); }, 'fetch failed'],
  ])('unchecked on %s', async (_what, answer, detail) => {
    expect(await setup(answer as any).store.checkPrivate()).toEqual({ ok: false, reason: 'storage_check_failed', detail: expect.stringContaining(detail) });
  });

  it('unchecked when the probe cannot be stored, and nothing is fetched', async () => {
    const fetchFn = vi.fn();
    const store = new S3RecordingStore(client(() => { throw new Error('InvalidAccessKeyId'); }), CONFIG, fetchFn as any);
    expect(await store.checkPrivate()).toEqual({ ok: false, reason: 'storage_check_failed', detail: expect.stringContaining('InvalidAccessKeyId') });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('createRecordingStore: S3', () => {
  const S3_ENV = { CALL_RECORDINGS_STORAGE: 's3', S3_ENDPOINT: 'http://minio:9000/', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 'b', S3_BUCKET: 'media' };
  const configOf = (env: Record<string, string>) => (createRecordingStore({ ...S3_ENV, ...env }, () => client()) as any).config;

  it('its own bucket when given, path style, and the endpoint and S3_PUBLIC_URL as the addresses checked', () => {
    const made: unknown[] = [];
    const store = createRecordingStore(
      { ...S3_ENV, CALL_RECORDINGS_BUCKET: 'recs', S3_PUBLIC_URL: 'https://cdn.example.com/', S3_REGION: 'ap-southeast-3', CALL_RECORDINGS_SSE: 'AES256' },
      (config) => {
        made.push(config);
        return client();
      },
    );
    expect(store).toBeInstanceOf(S3RecordingStore);
    expect(made).toEqual([{ endpoint: 'http://minio:9000', region: 'ap-southeast-3', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, forcePathStyle: true }]);
    expect((store as any).config).toEqual({ bucket: 'recs', prefix: 'call-recordings/', sse: 'AES256', publicBases: ['http://minio:9000', 'https://cdn.example.com'] });
  });

  it('the media bucket by default; a prefix always ends with one slash and is never empty', () => {
    expect(configOf({})).toMatchObject({ bucket: 'media', prefix: 'call-recordings/', publicBases: ['http://minio:9000'] });
    expect(configOf({ CALL_RECORDINGS_PREFIX: '/calls' })).toMatchObject({ prefix: 'calls/' });
    expect(configOf({ CALL_RECORDINGS_PREFIX: 'a/b/' })).toMatchObject({ prefix: 'a/b/' });
    expect(configOf({ CALL_RECORDINGS_PREFIX: '/' })).toMatchObject({ prefix: 'call-recordings/' });
  });

  it.each([
    [{ S3_ENDPOINT: '' }, 'S3_ENDPOINT'],
    [{ S3_SECRET_KEY: ' ' }, 'S3_SECRET_KEY'],
    [{ S3_BUCKET: '' }, 'CALL_RECORDINGS_BUCKET'],
    [{ CALL_RECORDINGS_SSE: 'des' }, 'CALL_RECORDINGS_SSE must be AES256 or aws:kms'],
  ])('a store that says what is wrong: %j', (env, problem) => {
    expect(createRecordingStore({ ...S3_ENV, ...env }, () => client())).toMatchObject({ type: 's3', problem: expect.stringContaining(problem) });
  });

  it('STORAGE_TYPE when CALL_RECORDINGS_STORAGE is not set', () => {
    expect(createRecordingStore({ ...S3_ENV, CALL_RECORDINGS_STORAGE: '', STORAGE_TYPE: 's3' }, () => client())).toBeInstanceOf(S3RecordingStore);
    expect(createRecordingStore({ ...S3_ENV, CALL_RECORDINGS_STORAGE: 'local', STORAGE_TYPE: 's3' })).not.toBeInstanceOf(LocalRecordingStore); // local, CALL_RECORDINGS_PATH unset
    expect(createRecordingStore({ ...S3_ENV, CALL_RECORDINGS_STORAGE: 'local', STORAGE_TYPE: 's3' }).type).toBe('local');
  });
});

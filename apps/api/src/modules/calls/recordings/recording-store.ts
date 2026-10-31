// MultiWA Gateway - private storage of call recordings and announcements
// apps/api/src/modules/calls/recordings/recording-store.ts
//
// NOT the uploads storage (IStorageAdapter): that one puts S3 objects public-read and serves local files without a
// login, because WhatsApp fetches media by URL. Recordings are personal data. Nothing here makes a URL, every read goes
// through the API (owner/admin, audited), and the storage itself is checked to refuse anonymous reads (checkPrivate)
// before recording can be turned on, and every night.
//
// Keys never carry a phone number. The nightly sweep deletes only keys of these shapes (isStoreKey), so a store that
// shares a bucket or a directory with anything else never loses what is not its own:
//   <orgId>/<profileId>/<yyyy>/<mm>/<callId>.webm    a recording (the month of the call, UTC)
//   announcements/<orgId>/<profileId>/<uuid>.<ext>   an announcement
//   probe/<uuid>                                     the privacy check's probe, deleted at once
// and each of them + '.<8 hex>.part': a local write not yet renamed into place.
import { randomBytes, randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
  type GetObjectCommandOutput, type HeadObjectCommandOutput, type ListObjectsV2CommandOutput, type S3ClientConfig,
} from '@aws-sdk/client-s3';

export const RECORDING_STORE = 'RECORDING_STORE';

export type RecordingStorageType = 'local' | 's3';

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

export type PrivacyFailure = 'recordings_storage_unset' | 'storage_not_private' | 'storage_check_failed';
export type PrivacyCheck = { ok: true } | { ok: false; reason: PrivacyFailure; detail: string };

export interface RecordingStore {
  readonly type: RecordingStorageType;
  /**
   * Where in that type of storage: "local:<root>" or "s3:<bucket>/<prefix>" ('' when unset). A recording keeps the
   * location it was stored at: one elsewhere (another directory, bucket or prefix) is out of this store's reach.
   */
  readonly location: string;
  /**
   * What is wrong with the settings (nothing can be stored), or null when the store works. It names settings, never
   * what they are set to: GET /calls/media/status shows it to the owners and admins of every organization.
   */
  readonly problem: string | null;
  /** Stores the object privately, replacing what the key held. */
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  /** The object's size in bytes, or null when there is none. */
  size(key: string): Promise<number | null>;
  /** The bytes from `start` to `end` (inclusive), or the whole object. A missing object rejects, with code ENOENT. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  /** A missing object is not an error. */
  delete(key: string): Promise<void>;
  /** Every object of the store, in no particular order. */
  list(): AsyncIterable<StoredObject>;
  /** Puts a probe, checks that nobody can read it without credentials, deletes it. */
  checkPrivate(): Promise<PrivacyCheck>;
}

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ANNOUNCEMENT = `announcements/${ID}/${ID}/${ID}\\.(mp3|wav|ogg|webm|m4a)`;
const OWN_KEY = new RegExp(`^(${ID}/${ID}/\\d{4}/\\d{2}/${ID}\\.webm|${ANNOUNCEMENT}|probe/${ID})(\\.[0-9a-f]{8}\\.part)?$`);
const ANNOUNCEMENT_KEY = new RegExp(`^${ANNOUNCEMENT}$`);

/** The key of a call's recording. */
export function recordingKey(organizationId: string, profileId: string, callId: string, startedAt: Date): string {
  const month = String(startedAt.getUTCMonth() + 1).padStart(2, '0');
  return `${organizationId}/${profileId}/${startedAt.getUTCFullYear()}/${month}/${callId}.webm`;
}

/** A new key for an announcement of the profile. */
export const announcementKey = (organizationId: string, profileId: string, ext: string): string =>
  `announcements/${organizationId}/${profileId}/${randomUUID()}.${ext}`;

/** Whether the key has one of the store's own shapes: the sweep never touches any other. */
export const isStoreKey = (key: string): boolean => OWN_KEY.test(key);

/**
 * Whether the key is an announcement of this profile: a key read back from the settings is checked before it is served
 * or deleted. Profile ids are unique, so the profile's segment says whose it is.
 */
export const isAnnouncementOf = (key: string, profileId: string): boolean => ANNOUNCEMENT_KEY.test(key) && key.split('/')[2] === profileId;

const logger = new Logger('RecordingStore');
// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const probeKey = () => `probe/${randomUUID()}`;
const reasonOf = (e: unknown) => String((e as Error)?.message ?? e);
const notFound = (e: unknown) => (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;

/** A store whose settings are missing or wrong: recording cannot be turned on, and there is nothing to list or sweep. */
export class UnsetRecordingStore implements RecordingStore {
  readonly location = '';

  constructor(readonly type: RecordingStorageType, readonly problem: string) {}

  async put(): Promise<void> {
    throw new Error(this.problem);
  }

  async size(): Promise<number | null> {
    throw new Error(this.problem);
  }

  async read(): Promise<Readable> {
    throw new Error(this.problem);
  }

  async delete(): Promise<void> {
    throw new Error(this.problem);
  }

  async *list(): AsyncIterable<StoredObject> {
    yield* [];
  }

  async checkPrivate(): Promise<PrivacyCheck> {
    return { ok: false, reason: 'recordings_storage_unset', detail: this.problem };
  }
}

/** Recordings in a directory of their own (CALL_RECORDINGS_PATH). */
export class LocalRecordingStore implements RecordingStore {
  readonly type = 'local';
  readonly problem = null;
  readonly location: string;

  constructor(private readonly root: string) {
    this.location = `local:${root}`;
  }

  // Rebuilt from basename()-stripped segments, '.' and '..' refused: no key, not even one read back from the database,
  // reaches outside the root. (The shape CodeQL models as a js/path-injection sanitizer, as in LocalStorageAdapter.)
  private path(key: string): string {
    const segments = key.split('/').filter(Boolean).map((s) => basename(s));
    if (!segments.length || segments.some((s) => s === '.' || s === '..')) throw new Error(`Not a storage key: ${key.replace(/[\r\n]/g, '')}`);
    return join(this.root, ...segments);
  }

  async put(key: string, body: Buffer, _mimeType: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // Written aside, then renamed into place: a reader never sees half a file. Aside under a name of its own: two
    // writes of one key at once would interleave in a shared one.
    const part = `${path}.${randomBytes(4).toString('hex')}.part`;
    await writeFile(part, body);
    await rename(part, path);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.path(key))).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  // Opened first, so a missing file rejects here: a stream that fails later is an unhandled 'error' before anyone
  // listens, or a 500 after the headers went. The stream closes the handle when it ends.
  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const handle = await open(this.path(key), 'r');
    return handle.createReadStream(range ? { start: range.start, end: range.end } : {});
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  // ponytail: readdir holds the whole tree at once; walk it with opendir if a store ever nears a million files.
  async *list(): AsyncIterable<StoredObject> {
    for (const entry of await readdir(this.root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const info = await stat(path).catch(() => null); // deleted meanwhile
      if (info) yield { key: relative(this.root, path).split(sep).join('/'), size: info.size, lastModified: info.mtime };
    }
  }

  // Nothing serves this directory: the media route serves its own folder only, and this directory cannot overlap it
  // (createRecordingStore). So the check is that the store works: a probe written, read back and deleted.
  async checkPrivate(): Promise<PrivacyCheck> {
    const key = probeKey();
    try {
      await this.put(key, Buffer.from('probe'), 'text/plain');
      return (await this.size(key)) === 5 ? { ok: true } : { ok: false, reason: 'storage_check_failed', detail: 'the probe did not read back' };
    } catch (e) {
      return { ok: false, reason: 'storage_check_failed', detail: reasonOf(e) };
    } finally {
      await this.delete(key).catch(() => undefined);
    }
  }
}

/** The part of the S3 client used here (a stand-in in the specs). */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}

export interface S3RecordingStoreConfig {
  bucket: string;
  /** Never empty; ends with '/'. */
  prefix: string;
  sse?: 'AES256' | 'aws:kms';
  /** Where the probe is fetched without credentials: S3_ENDPOINT, and S3_PUBLIC_URL when set. */
  publicBases: string[];
}

// What a private bucket answers a request without credentials.
const REFUSED = new Set([400, 401, 403, 404]);
const PROBE_FETCH_MS = 5_000;

/**
 * Recordings in an S3-compatible bucket: AWS S3, MinIO, Wasabi, Backblaze B2, Cloudflare R2, DigitalOcean Spaces,
 * Google Cloud Storage (XML API). No ACL is sent, so an object is as private as its bucket; SSE when configured.
 *
 * The privacy check sees only the addresses it is given (publicBases). A public URL of the bucket's own (Cloudflare R2's
 * r2.dev, a custom domain) or a CDN that reads the bucket with credentials of its own is not seen: operators must turn
 * those off for the recordings bucket.
 */
export class S3RecordingStore implements RecordingStore {
  readonly type = 's3';
  readonly problem = null;
  readonly location: string;

  constructor(
    private readonly s3: S3Like,
    private readonly config: S3RecordingStoreConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    // The bucket and the prefix, not the endpoint: the same bucket is often reached at a new address (http to https,
    // an internal name), and its recordings are no less its own.
    this.location = `s3:${config.bucket}/${config.prefix}`;
  }

  private object(key: string) {
    return { Bucket: this.config.bucket, Key: this.config.prefix + key };
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ ...this.object(key), Body: body, ContentType: mimeType, ...(this.config.sse ? { ServerSideEncryption: this.config.sse } : {}) }));
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = (await this.s3.send(new HeadObjectCommand(this.object(key)))) as HeadObjectCommandOutput;
      return head.ContentLength ?? 0;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    try {
      const object = (await this.s3.send(new GetObjectCommand({ ...this.object(key), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }))) as GetObjectCommandOutput;
      return object.Body as Readable;
    } catch (e) {
      // As the local store rejects a missing file: its readers tell "missing" from "failing" by the code alone.
      if (notFound(e)) throw Object.assign(new Error('The object does not exist'), { code: 'ENOENT' });
      throw e;
    }
  }

  // With versioning on, a delete only adds a delete marker and the recording stays in the bucket: the recordings bucket
  // must have versioning off, or a lifecycle rule that expires noncurrent versions.
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand(this.object(key)));
  }

  async *list(): AsyncIterable<StoredObject> {
    let token: string | undefined;
    do {
      const page = (await this.s3.send(new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: this.config.prefix, ContinuationToken: token }))) as ListObjectsV2CommandOutput;
      for (const o of page.Contents ?? []) {
        // Without a time an object counts as new: never old enough for the sweep.
        if (o.Key?.startsWith(this.config.prefix)) yield { key: o.Key.slice(this.config.prefix.length), size: o.Size ?? 0, lastModified: o.LastModified ?? new Date() };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  // A probe with bytes of its own, fetched WITHOUT credentials (plain fetch, following redirects) at every address the
  // bucket may be reached on: a reply carrying those bytes means anyone can read the recordings. A refusal is what a
  // private bucket answers, and a 2xx with other bytes (a login page in front) is not the object. Anything else proves
  // nothing, so the check fails, but only once every address was fetched: one that serves the probe outweighs it.
  async checkPrivate(): Promise<PrivacyCheck> {
    const key = probeKey();
    const probe = randomBytes(16).toString('hex');
    try {
      await this.put(key, Buffer.from(probe), 'text/plain');
    } catch (e) {
      return { ok: false, reason: 'storage_check_failed', detail: `the probe could not be stored: ${reasonOf(e)}` };
    }
    try {
      let unchecked: string | undefined;
      for (const base of this.config.publicBases) {
        const url = `${base}/${this.config.bucket}/${this.config.prefix}${key}`;
        const answer = await this.fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(PROBE_FETCH_MS) })
          .then(async (res) => ({ status: res.status, body: await res.text() }))
          .catch((e: unknown) => ({ error: reasonOf(e) }));
        if ('error' in answer) {
          unchecked ??= `${url}: ${answer.error}`;
          continue;
        }
        const success = answer.status >= 200 && answer.status < 300;
        if (success && answer.body === probe) return { ok: false, reason: 'storage_not_private', detail: `${url} is readable without credentials` };
        if (!success && !REFUSED.has(answer.status)) unchecked ??= `${url} answered ${answer.status}`;
      }
      return unchecked ? { ok: false, reason: 'storage_check_failed', detail: unchecked } : { ok: true };
    } finally {
      await this.delete(key).catch(() => undefined);
    }
  }
}

/** a is b, or inside it. */
const inside = (a: string, b: string) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
const overlaps = (a: string, b: string) => inside(a, b) || inside(b, a);

const SAFE_PREFIX = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Whether the URL's host is this host: localhost, 127.0.0.0/8 or [::1]. */
function isLoopback(url: string): boolean {
  try {
    return /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(new URL(url).hostname);
  } catch {
    return false; // not a URL: fetched, and the fetch fails the check, which shows it
  }
}

/** "a", "a and b", "a, b and c". */
const listed = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(''));

/**
 * The store the environment asks for. A missing or wrong setting gives a store whose `problem` says which: the API
 * starts all the same, and recording cannot be turned on.
 */
export function createRecordingStore(env: NodeJS.ProcessEnv, makeS3: (config: S3ClientConfig) => S3Like = (config) => new S3Client(config)): RecordingStore {
  // `|| undefined`: compose passes an unset variable as an empty string.
  const value = (name: string) => env[name]?.trim() || undefined;
  const typeFrom = value('CALL_RECORDINGS_STORAGE') ? 'CALL_RECORDINGS_STORAGE' : 'STORAGE_TYPE';
  const type = value(typeFrom) ?? 'local';
  if (type === 's3') {
    const endpoint = value('S3_ENDPOINT')?.replace(/\/+$/, '');
    const accessKeyId = value('S3_ACCESS_KEY');
    const secretAccessKey = value('S3_SECRET_KEY');
    const bucket = value('CALL_RECORDINGS_BUCKET') ?? value('S3_BUCKET');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      const settings: Array<[string, string | undefined]> = [
        ['S3_ENDPOINT', endpoint], ['S3_ACCESS_KEY', accessKeyId], ['S3_SECRET_KEY', secretAccessKey], ['CALL_RECORDINGS_BUCKET (or S3_BUCKET)', bucket],
      ];
      return new UnsetRecordingStore('s3', `S3 recordings need ${listed(settings.filter(([, v]) => !v).map(([name]) => name))}`);
    }
    const sse = value('CALL_RECORDINGS_SSE');
    if (sse !== undefined && sse !== 'AES256' && sse !== 'aws:kms') return new UnsetRecordingStore('s3', 'CALL_RECORDINGS_SSE must be AES256 or aws:kms');
    // Never empty: the probes and the sweep's listing must not sit at the root of a bucket shared with the media. And
    // of safe characters only: the SDK encodes the key it puts, but the probe's URL is joined as a string, which fetch
    // reads its own way (%41 decoded, cut at # or ?, \ made /), so the probe would be fetched at another key.
    const prefix = (value('CALL_RECORDINGS_PREFIX') ?? '').replace(/^\/+|\/+$/g, '') || 'call-recordings';
    if (!SAFE_PREFIX.test(prefix) || prefix.split('/').some((s) => s === '.' || s === '..')) {
      return new UnsetRecordingStore('s3', 'CALL_RECORDINGS_PREFIX may hold only letters, digits, ".", "_", "-" and "/" (and no "." or ".." segment)');
    }
    const publicUrl = value('S3_PUBLIC_URL')?.replace(/\/+$/, '');
    return new S3RecordingStore(
      makeS3({
        endpoint, region: value('S3_REGION') ?? 'us-east-1', credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true,
        // Without them a storage that stops answering holds the request for as long as it stays silent (a profile's
        // purge runs inside its DELETE request): 5 s to connect, and two minutes of a silent socket, generous as a
        // streamed read pauses the socket while the client reads slowly. Not requestTimeout: this SDK only warns past it.
        requestHandler: { connectionTimeout: 5_000, socketTimeout: 120_000 },
      }),
      {
        bucket,
        prefix: `${prefix}/`,
        sse,
        // A loopback S3_PUBLIC_URL names the api's own host or container, never another way to the bucket: the dev
        // compose's http://localhost:9000 is the browser's address of the MinIO the endpoint already reaches, and from
        // inside the api's container it reaches nothing, so the check could never pass.
        publicBases: [...new Set([endpoint, ...(publicUrl && !isLoopback(publicUrl) ? [publicUrl] : [])])],
      },
    );
  }
  // Not what it is set to: a path given there in place of CALL_RECORDINGS_PATH would be shown to every organization.
  if (type !== 'local') return new UnsetRecordingStore('local', `${typeFrom} must be local or s3`);
  const path = value('CALL_RECORDINGS_PATH');
  if (!path) return new UnsetRecordingStore('local', 'CALL_RECORDINGS_PATH is not set');
  const root = resolve(path);
  // The media folder is served without a login, the sessions volume is snapshotted with every session, and a root
  // around the application would be walked whole by the nightly sweep. Without SESSIONS_DIR the engines keep their
  // sessions in /data/sessions or ./sessions (EngineManagerService): neither may overlap then.
  const sessions = value('SESSIONS_DIR');
  const clashes: Array<[string, boolean]> = [
    ['STORAGE_PATH', overlaps(root, resolve(value('STORAGE_PATH') ?? './media'))],
    [
      sessions ? 'SESSIONS_DIR' : 'SESSIONS_DIR (unset: /data/sessions and ./sessions)',
      (sessions ? [sessions] : ['/data/sessions', './sessions']).some((d) => overlaps(root, resolve(d))),
    ],
    ['the working directory', inside(process.cwd(), root)],
  ];
  const clash = clashes.find(([, yes]) => yes);
  if (clash) return new UnsetRecordingStore('local', `CALL_RECORDINGS_PATH must be a directory of its own, not inside or around ${clash[0]}`);
  try {
    mkdirSync(root, { recursive: true });
  } catch (e) {
    // The reason names the path (EACCES … mkdir '/data/…'): it goes to the server log only.
    logger.warn(`CALL_RECORDINGS_PATH (${clean(root)}) cannot be created: ${clean(reasonOf(e))}`);
    return new UnsetRecordingStore('local', 'CALL_RECORDINGS_PATH cannot be created (the server log says why)');
  }
  return new LocalRecordingStore(root);
}

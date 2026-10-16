import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadsModule } from './uploads.module';
import { STORAGE_ADAPTER } from './storage.interface';

// The adapters are stubbed so building the provider never touches the disk or S3.
const adapters = vi.hoisted(() => ({ local: vi.fn(), s3: vi.fn() }));
vi.mock('./local-storage.adapter', () => ({ LocalStorageAdapter: adapters.local }));
vi.mock('./s3-storage.adapter', () => ({ S3StorageAdapter: adapters.s3 }));

type Factory = (config: { get: (key: string, fallback?: string) => string | undefined }) => unknown;

const storageFactory = (): Factory => {
  const providers = Reflect.getMetadata('providers', UploadsModule) as Array<{
    provide?: unknown;
    useFactory?: Factory;
  }>;
  return providers.find((p) => p.provide === STORAGE_ADAPTER)!.useFactory!;
};

// ConfigService.get(key, default) substitutes the default only for a MISSING key:
// a key that is present but empty (a compose `${VAR}` that expands to nothing) is
// returned as ''. This stub reproduces exactly that.
const configWith = (env: Record<string, string>) => ({
  get: (key: string, fallback?: string) => (key in env ? env[key] : fallback),
});

describe('storage adapter provider', () => {
  beforeEach(() => {
    adapters.local.mockClear();
    adapters.s3.mockClear();
  });

  it('keeps an explicit STORAGE_PATH', () => {
    storageFactory()(configWith({ STORAGE_TYPE: 'local', STORAGE_PATH: '/data/uploads' }));
    expect(adapters.local).toHaveBeenCalledWith('/data/uploads', expect.any(String));
  });

  it('uses ./media when STORAGE_PATH is missing', () => {
    storageFactory()(configWith({}));
    expect(adapters.local).toHaveBeenCalledWith('./media', expect.any(String));
  });

  // resolve('') is the process working directory: an empty path would write uploads into,
  // and serve the media route out of, the application directory.
  it('uses ./media, never an empty path, when STORAGE_PATH is set but empty', () => {
    storageFactory()(configWith({ STORAGE_TYPE: 'local', STORAGE_PATH: '' }));
    expect(adapters.local).toHaveBeenCalledTimes(1);
    expect(adapters.local.mock.calls[0][0]).toBe('./media');
  });

  it('still falls back to local storage when STORAGE_TYPE is empty', () => {
    storageFactory()(configWith({ STORAGE_TYPE: '' }));
    expect(adapters.local).toHaveBeenCalledTimes(1);
    expect(adapters.s3).not.toHaveBeenCalled();
  });

  it('still builds the S3 adapter when asked to', () => {
    storageFactory()(configWith({ STORAGE_TYPE: 's3' }));
    expect(adapters.s3).toHaveBeenCalledTimes(1);
    expect(adapters.local).not.toHaveBeenCalled();
  });
});

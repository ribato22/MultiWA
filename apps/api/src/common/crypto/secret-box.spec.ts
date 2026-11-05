// Secrets at rest. The format and the key derivation are pinned with values encrypted before these helpers moved here
// from SettingsService, so an S3 or SMTP secret saved by an earlier release still reads back.
import { createHash } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt, getEncryptionKey } from './secret-box';

const HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const UNDER_HEX_KEY = '00112233445566778899aabbccddeeff:da307f0b3f43ce1b77f14e89077ed84e:2f76d72d7e8d2054d5f1ee1142d3';
const UNDER_SHORT_KEY = 'ffeeddccbbaa99887766554433221100:8c5fae116f4fd01408e5d57dd499d812:aae9812ecf23bd9ad834d7754cbd';

describe('secret-box', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads a value an earlier release wrote, with a 64-hex key and with any other key', () => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    expect(decrypt(UNDER_HEX_KEY)).toBe('lookup-token-1');
    vi.stubEnv('ENCRYPTION_KEY', 'a-short-dev-key');
    expect(decrypt(UNDER_SHORT_KEY)).toBe('lookup-token-2');
  });

  it('writes iv:authTag:ciphertext in hex with a fresh IV each time, and reads it back', () => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    const [a, b] = [encrypt('s3cr3t'), encrypt('s3cr3t')];
    expect(a).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(a).not.toBe(b);
    expect([decrypt(a), decrypt(b)]).toEqual(['s3cr3t', 's3cr3t']);
  });

  it("answers '' for a value it cannot read: a changed byte, another format, another key", () => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    const sealed = encrypt('s3cr3t');
    expect(decrypt(sealed.slice(0, -1) + (sealed.endsWith('0') ? '1' : '0'))).toBe('');
    expect(decrypt('not-encrypted')).toBe('');
    vi.stubEnv('ENCRYPTION_KEY', 'another-key');
    expect(decrypt(sealed)).toBe('');
  });

  it('takes 64 hex characters as the key bytes, and anything else through SHA-256', () => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    expect(getEncryptionKey().toString('hex')).toBe(HEX_KEY);
    vi.stubEnv('ENCRYPTION_KEY', 'a-short-dev-key');
    expect(getEncryptionKey().toString('hex')).toBe(createHash('sha256').update('a-short-dev-key').digest('hex'));
  });

  it('makes up no key in production, and an ephemeral one elsewhere', () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getEncryptionKey()).toThrow('ENCRYPTION_KEY is required in production');
    vi.stubEnv('NODE_ENV', 'development');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getEncryptionKey()).toHaveLength(32);
    expect(process.env.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
  });
});

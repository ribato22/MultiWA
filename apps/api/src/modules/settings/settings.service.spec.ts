// SettingsService keeps the S3 and SMTP secrets encrypted. A secret an earlier release stored must still read back, and
// a new one is stored encrypted, never as it was typed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { systemSettings: { findUnique: vi.fn(), upsert: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { SettingsService } from './settings.service';

const db = prisma as any;
const HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// 'lookup-token-1', encrypted under HEX_KEY with the IV 00112233445566778899aabbccddeeff.
const STORED = '00112233445566778899aabbccddeeff:da307f0b3f43ce1b77f14e89077ed84e:2f76d72d7e8d2054d5f1ee1142d3';

describe('SettingsService secrets', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    db.systemSettings.findUnique.mockReset();
    db.systemSettings.upsert.mockReset().mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads back an S3 secret key stored by an earlier release', async () => {
    db.systemSettings.findUnique.mockResolvedValue({ key: 'storage', value: { type: 's3', s3SecretKeyEnc: STORED } });
    expect((await new SettingsService().getStorageConfig()).s3SecretKey).toBe('lookup-token-1');
  });

  it('stores a new SMTP password encrypted, and reads it back', async () => {
    db.systemSettings.findUnique.mockResolvedValue(null);
    await new SettingsService().updateSmtpConfig({ host: 'smtp.example.com', port: 587, pass: 'p4ss-w0rd' });
    const stored = db.systemSettings.upsert.mock.calls[0][0].create.value.passEnc;
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(JSON.stringify(db.systemSettings.upsert.mock.calls)).not.toContain('p4ss-w0rd');
    db.systemSettings.findUnique.mockResolvedValue({ key: 'smtp', value: { host: 'smtp.example.com', passEnc: stored } });
    expect((await new SettingsService().getSmtpConfig()).pass).toBe('p4ss-w0rd');
  });
});

describe('SettingsService storage type', () => {
  beforeEach(() => db.systemSettings.findUnique.mockReset().mockResolvedValue(null));
  afterEach(() => vi.unstubAllEnvs());

  // Uploads go where STORAGE_TYPE says. S3_ENDPOINT alone may be there for call recordings (CALL_RECORDINGS_STORAGE=s3).
  it('reports the storage STORAGE_TYPE picks for uploads, not S3 because an S3 endpoint is set', async () => {
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.com');
    vi.stubEnv('STORAGE_TYPE', 'local');
    expect((await new SettingsService().getStorageConfig()).type).toBe('local');
    vi.stubEnv('STORAGE_TYPE', 's3');
    expect((await new SettingsService().getStorageConfig()).type).toBe('s3');
  });
});

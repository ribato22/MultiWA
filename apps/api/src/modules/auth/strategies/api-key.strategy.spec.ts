// ApiKeyStrategy: an API key authenticates only while it exists, has not expired, and its
// owner is still an active user (the JWT strategy refuses inactive users the same way).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

vi.mock('@multiwa/database', () => ({
  prisma: { apiKey: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { prisma } from '@multiwa/database';
import { ApiKeyStrategy } from './api-key.strategy';

const db = prisma as any;
const RAW = 'mwa_test_key';

function key(over: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    keyHash: crypto.createHash('sha256').update(RAW).digest('hex'),
    permissions: ['messages:write'],
    expiresAt: null,
    lastUsedAt: null,
    user: { id: 'u1', email: 'user@example.com', name: 'User', role: 'admin', organizationId: 'o1', organization: { id: 'o1' }, isActive: true, ...user },
    ...over,
  };
}

const validate = (headers: Record<string, string>) => new ApiKeyStrategy().validate({ headers });

beforeEach(() => {
  db.apiKey.findUnique.mockReset();
  db.apiKey.update.mockReset().mockResolvedValue({});
});

describe('ApiKeyStrategy', () => {
  it('requires a key', async () => {
    await expect(validate({})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an unknown key', async () => {
    db.apiKey.findUnique.mockResolvedValue(null);
    await expect(validate({ 'x-api-key': RAW })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an expired key', async () => {
    db.apiKey.findUnique.mockResolvedValue(key({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(validate({ 'x-api-key': RAW })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses the key of a deactivated user, without touching lastUsedAt', async () => {
    db.apiKey.findUnique.mockResolvedValue(key({}, { isActive: false }));
    await expect(validate({ 'x-api-key': RAW })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.apiKey.update).not.toHaveBeenCalled();
  });

  it('authenticates an active user and records the use', async () => {
    db.apiKey.findUnique.mockResolvedValue(key());
    await expect(validate({ 'x-api-key': RAW })).resolves.toMatchObject({ id: 'u1', organizationId: 'o1', apiKeyId: 'k1', apiKeyScopes: ['messages:write'] });
    expect(db.apiKey.update).toHaveBeenCalledTimes(1);
  });
});

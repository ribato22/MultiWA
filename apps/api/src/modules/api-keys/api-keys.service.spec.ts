// ApiKeysService unit tests — lock the security invariants of API-key issuance:
// create() must mint a `mwa_`-prefixed raw key, hand it back exactly ONCE, and
// persist ONLY a sha256 hash of it (never the raw secret); list() must never
// select/leak keyHash; delete() must enforce ownership. Prisma is mocked; real
// node:crypto runs so we can verify the stored hash is a genuine sha256(rawKey).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

vi.mock('@multiwa/database', () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from '@multiwa/database';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(() => {
    vi.mocked(prisma.apiKey.create).mockReset();
    vi.mocked(prisma.apiKey.findMany).mockReset();
    vi.mocked(prisma.apiKey.findUnique).mockReset();
    vi.mocked(prisma.apiKey.delete).mockReset();
    service = new ApiKeysService();

    // Echo the persisted row back with a synthetic id/createdAt, mirroring Prisma.
    (prisma.apiKey.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'key_1',
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      expiresAt: null,
      lastUsedAt: null,
      ...data,
    }));
  });

  describe('create', () => {
    it('mints a mwa_-prefixed raw key and returns it exactly once, with prefix = first 12 chars', async () => {
      const result = await service.create('user-1', 'CI token');

      expect(result.key).toMatch(/^mwa_[0-9a-f]{64}$/);
      expect(result.prefix).toBe(result.key.substring(0, 12));
      expect(result.prefix.startsWith('mwa_')).toBe(true);
      expect(result.name).toBe('CI token');
    });

    it('creates a non-expiring key by default', async () => {
      await service.create('user-1', 'k');
      const persisted = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data as any;
      expect(persisted.expiresAt).toBeNull();
    });

    it('sets expiresAt ~N days out when expiresInDays is given', async () => {
      const before = Date.now();
      await service.create('user-1', 'k', [], 7);
      const persisted = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data as any;
      expect(persisted.expiresAt).toBeInstanceOf(Date);
      const ms = persisted.expiresAt.getTime() - before;
      expect(ms).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
      expect(ms).toBeLessThan(7.1 * 24 * 3600 * 1000);
    });

    it('persists ONLY a sha256 hash of the raw key — never the raw secret', async () => {
      const result = await service.create('user-1', 'CI token');

      const persisted = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data;
      const expectedHash = crypto.createHash('sha256').update(result.key).digest('hex');

      expect(persisted.keyHash).toBe(expectedHash);
      // The stored hash must not equal the raw key, and the raw key must not be
      // stored under any persisted field.
      expect(persisted.keyHash).not.toBe(result.key);
      expect(Object.values(persisted)).not.toContain(result.key);
      // The returned object must never surface the hash.
      expect(result).not.toHaveProperty('keyHash');
    });

    it('scopes the key to the caller and persists an empty permissions array by default', async () => {
      const result = await service.create('user-42', 'default-perms');

      const persisted = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data;
      expect(persisted.userId).toBe('user-42');
      expect(persisted.permissions).toEqual([]);
      expect(result.permissions).toEqual([]);
    });

    it('persists the caller-supplied permissions verbatim', async () => {
      const perms = ['messages:send', 'messages:read'];
      const result = await service.create('user-1', 'scoped', perms);

      const persisted = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data;
      expect(persisted.permissions).toEqual(perms);
      expect(result.permissions).toEqual(perms);
    });

    it('never reuses the same raw key/hash across two issuances', async () => {
      const a = await service.create('user-1', 'a');
      const b = await service.create('user-1', 'b');
      expect(a.key).not.toBe(b.key);

      const hashA = vi.mocked(prisma.apiKey.create).mock.calls[0][0].data.keyHash;
      const hashB = vi.mocked(prisma.apiKey.create).mock.calls[1][0].data.keyHash;
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('findAll', () => {
    it('never selects keyHash and returns a masked key derived from the prefix', async () => {
      vi.mocked(prisma.apiKey.findMany).mockResolvedValueOnce([
        { id: 'key_1', name: 'k', prefix: 'mwa_abc12345', permissions: [], createdAt: new Date() } as any,
      ]);

      const keys = await service.findAll('user-1');

      // The Prisma query must be scoped to the user and must NOT request keyHash.
      const arg = vi.mocked(prisma.apiKey.findMany).mock.calls[0][0] as any;
      expect(arg.where).toEqual({ userId: 'user-1' });
      expect(arg.select.keyHash).toBeUndefined();

      // The mapped result masks the secret and never carries a hash.
      expect(keys[0].key).toBe('mwa_abc12345••••••••••••');
      expect(keys[0]).not.toHaveProperty('keyHash');
    });
  });

  describe('delete', () => {
    it('throws NotFound and deletes nothing when the key is missing', async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce(null);
      await expect(service.delete('key_x', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.delete).not.toHaveBeenCalled();
    });

    it('throws Forbidden (IDOR guard) and deletes nothing when the key belongs to another user', async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({ id: 'key_1', userId: 'owner' } as any);
      await expect(service.delete('key_1', 'attacker')).rejects.toThrow(ForbiddenException);
      expect(prisma.apiKey.delete).not.toHaveBeenCalled();
    });

    it('deletes by id only when the caller owns the key', async () => {
      vi.mocked(prisma.apiKey.findUnique).mockResolvedValueOnce({ id: 'key_1', userId: 'user-1' } as any);
      vi.mocked(prisma.apiKey.delete).mockResolvedValueOnce({ id: 'key_1' } as any);

      await expect(service.delete('key_1', 'user-1')).resolves.toEqual({ success: true });
      expect(prisma.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'key_1' } });
    });
  });
});

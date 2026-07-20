// ContactsService Unit Tests — locks three invariants:
//   1. normalizePhone() is deterministic: any Indonesian/international spelling of
//      the same number collapses to one digits-only, 62-prefixed form.
//   2. The #80 type-confusion fix: addTags/removeTags coerce a non-array/non-string
//      `tags` argument to [] so it can NEVER throw on spread, and removeTags never
//      falls back to String.includes substring matching that would delete unrelated
//      tags. A malformed input must leave existing tags untouched.
//   3. create() de-dupes tags when merging into an existing contact.
// Prisma and the engine services are mocked, so these run without a DB or engine.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    contact: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    profile: { findUnique: vi.fn() },
  },
}));

// Light stubs so importing the service never pulls in engine adapters / puppeteer.
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../engine-commands/engine-commands.service', () => ({ EngineCommandsService: class {} }));

import { prisma } from '@multiwa/database';
import { ContactsService } from './contacts.service';

function makeService(): ContactsService {
  // The constructor only stores its deps; none are touched on the paths tested here.
  return new ContactsService({} as any, {} as any);
}

describe('ContactsService', () => {
  let service: ContactsService;

  beforeEach(() => {
    vi.mocked(prisma.contact.findFirst).mockReset();
    vi.mocked(prisma.contact.findUnique).mockReset();
    vi.mocked(prisma.contact.create).mockReset();
    vi.mocked(prisma.contact.update).mockReset();
    // update/create echo the data back so the return value is inspectable.
    vi.mocked(prisma.contact.update).mockImplementation(async (args: any) => args.data);
    vi.mocked(prisma.contact.create).mockImplementation(async (args: any) => args.data);
    service = makeService();
  });

  describe('normalizePhone (deterministic)', () => {
    it('collapses every Indonesian spelling of one number to the same 62-prefixed digits', () => {
      const n = (p: string) => (service as any).normalizePhone(p);
      expect(n('081234567890')).toBe('6281234567890'); // local 0-prefix -> 62
      expect(n('+62 812-3456-7890')).toBe('6281234567890'); // +, spaces, dashes stripped
      expect(n('(0812) 3456-7890')).toBe('6281234567890'); // punctuation stripped, 0 -> 62
      expect(n('6281234567890')).toBe('6281234567890'); // already normalized -> unchanged
    });

    it('preserves a non-Indonesian country code (no spurious 62 rewrite)', () => {
      expect((service as any).normalizePhone('+1 (415) 555-2671')).toBe('14155552671');
    });
  });

  describe('addTags — #80 type-confusion safety + de-dup', () => {
    beforeEach(() => {
      vi.mocked(prisma.contact.findUnique).mockResolvedValue({
        id: 'c1',
        tags: ['vip', 'customer'],
      } as any);
    });

    it('does NOT throw and leaves tags untouched when `tags` is not an array', async () => {
      await expect(service.addTags('c1', 5 as any)).resolves.toBeDefined();
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { tags: ['vip', 'customer'] },
      });
    });

    it('keeps only string entries and de-dupes against existing tags', async () => {
      await service.addTags('c1', ['vip', 'new', 5, null, 'new'] as any);
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { tags: ['vip', 'customer', 'new'] },
      });
    });
  });

  describe('removeTags — #80 type-confusion safety', () => {
    beforeEach(() => {
      vi.mocked(prisma.contact.findUnique).mockResolvedValue({
        id: 'c1',
        tags: ['vip', 'customer'],
      } as any);
    });

    it('does NOT substring-delete when `tagsToRemove` is a bare string (fix, not String.includes)', async () => {
      // Pre-fix this ran 'vip'.includes('vip') === true and would have dropped the
      // 'vip' tag. The fix coerces the string to [] so nothing is removed.
      await expect(service.removeTags('c1', 'vip' as any)).resolves.toBeDefined();
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { tags: ['vip', 'customer'] },
      });
    });

    it('removes exactly the matching tags for a proper array', async () => {
      await service.removeTags('c1', ['vip']);
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { tags: ['customer'] },
      });
    });
  });

  describe('create', () => {
    it('de-dupes tags when merging into an existing contact', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValue({
        id: 'c1',
        name: 'Existing',
        tags: ['a', 'b'],
        metadata: {},
      } as any);

      await service.create({
        profileId: 'p',
        phone: '081234567890',
        name: 'New',
        tags: ['b', 'c', 'c'],
      } as any);

      expect(prisma.contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data: expect.objectContaining({ tags: ['a', 'b', 'c'] }),
        }),
      );
    });

    it('normalizes the phone before lookup and create for a new contact', async () => {
      vi.mocked(prisma.contact.findFirst).mockResolvedValue(null);

      await service.create({ profileId: 'p', phone: '081234567890', name: 'New' } as any);

      expect(prisma.contact.findFirst).toHaveBeenCalledWith({
        where: { profileId: 'p', phone: '6281234567890' },
      });
      expect(prisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '6281234567890', tags: [] }),
        }),
      );
    });
  });
});

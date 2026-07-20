// ConversationsService Unit Tests — the pure listing/filtering/pagination and
// mapping/normalization logic, plus not-found handling. Prisma is mocked (no DB)
// and GroupsService is stubbed so the WhatsApp engine chain never loads on Node.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    workspace: { findMany: vi.fn() },
    profile: { findMany: vi.fn() },
    conversation: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: { findMany: vi.fn() },
    message: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

// GroupsService drags in the engine adapters (puppeteer/native) through its
// EngineManager dependency; replace the module with a light class stub so the
// service file loads in isolation.
vi.mock('../groups/groups.service', () => ({ GroupsService: class {} }));

import { prisma } from '@multiwa/database';
import { ConversationsService } from './conversations.service';

function makeService(groupsStub: any = { getById: vi.fn() }): ConversationsService {
  return new ConversationsService(groupsStub);
}

describe('ConversationsService', () => {
  beforeEach(() => {
    vi.mocked(prisma.workspace.findMany).mockReset();
    vi.mocked(prisma.profile.findMany).mockReset();
    vi.mocked(prisma.conversation.aggregate).mockReset();
    vi.mocked(prisma.conversation.findMany).mockReset();
    vi.mocked(prisma.conversation.count).mockReset();
    vi.mocked(prisma.conversation.findUnique).mockReset();
    vi.mocked(prisma.conversation.update).mockReset().mockResolvedValue({} as any);
    vi.mocked(prisma.contact.findMany).mockReset();
    vi.mocked(prisma.message.findUnique).mockReset();
    vi.mocked(prisma.message.findMany).mockReset();
  });

  describe('getOrgUnreadCount (tenant scoping)', () => {
    it('returns 0 and never aggregates when the org has no workspaces', async () => {
      vi.mocked(prisma.workspace.findMany).mockResolvedValueOnce([] as any);

      const total = await makeService().getOrgUnreadCount('org-1');

      expect(total).toBe(0);
      expect(prisma.profile.findMany).not.toHaveBeenCalled();
      expect(prisma.conversation.aggregate).not.toHaveBeenCalled();
    });

    it('sums unreadCount over ONLY the org profiles (scoped `in` filter)', async () => {
      vi.mocked(prisma.workspace.findMany).mockResolvedValueOnce([{ id: 'w1' }, { id: 'w2' }] as any);
      vi.mocked(prisma.profile.findMany).mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }] as any);
      vi.mocked(prisma.conversation.aggregate).mockResolvedValueOnce({ _sum: { unreadCount: 42 } } as any);

      const total = await makeService().getOrgUnreadCount('org-1');

      expect(total).toBe(42);
      expect(prisma.profile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: { in: ['w1', 'w2'] } } }),
      );
      expect(prisma.conversation.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: { in: ['p1', 'p2'] } } }),
      );
    });
  });

  describe('findAll (filtering / pagination)', () => {
    it('applies default pagination (take 50 / skip 0) and filters only by profileId', async () => {
      vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.conversation.count).mockResolvedValueOnce(0 as any);

      const res = await makeService().findAll('prof-1', {});

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: 'prof-1' },
          take: 50,
          skip: 0,
          orderBy: { lastMessageAt: 'desc' },
        }),
      );
      expect(prisma.conversation.count).toHaveBeenCalledWith({ where: { profileId: 'prof-1' } });
      expect(res.total).toBe(0);
    });

    it('merges the type filter and honors custom limit/offset on both queries', async () => {
      vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.conversation.count).mockResolvedValueOnce(0 as any);

      await makeService().findAll('prof-1', { type: 'group', limit: 10, offset: 20 });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: 'prof-1', type: 'group' },
          take: 10,
          skip: 20,
        }),
      );
      expect(prisma.conversation.count).toHaveBeenCalledWith({
        where: { profileId: 'prof-1', type: 'group' },
      });
    });
  });

  describe('findAll (mapping / normalization)', () => {
    it('flattens counts + last message, resolves the contact name, and strips internal fields', async () => {
      const conv = {
        id: 'c1',
        profileId: 'prof-1',
        jid: '628999@s.whatsapp.net',
        type: 'user',
        name: '628999',
        unreadCount: 3,
        _count: { messages: 5 },
        contact: { name: 'Bob', phone: '628999' },
        messages: [{ id: 'm-last', body: 'hi' }],
      };
      vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([conv] as any);
      vi.mocked(prisma.conversation.count).mockResolvedValueOnce(1 as any);

      const { conversations } = await makeService().findAll('prof-1', {});
      const row = conversations[0] as any;

      expect(row.id).toBe('c1'); // spread preserved
      expect(row.messageCount).toBe(5);
      expect(row.lastMessage).toEqual({ id: 'm-last', body: 'hi' });
      expect(row.contactName).toBe('Bob');
      expect(row.contactPhone).toBe('628999');
      // linked contact means no phone-book fallback lookup happens
      expect(prisma.contact.findMany).not.toHaveBeenCalled();
      // internal join fields must not leak to the API response
      expect(row.messages).toBeUndefined();
      expect(row._count).toBeUndefined();
      expect(row.contact).toBeUndefined();
    });

    it('resolves an unlinked @s.whatsapp.net conversation name from the contact phone book', async () => {
      const conv = {
        id: 'c2',
        profileId: 'prof-1',
        jid: '628111@s.whatsapp.net',
        type: 'user',
        name: '628111',
        unreadCount: 0,
        _count: { messages: 0 },
        contact: null,
        messages: [],
      };
      vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([conv] as any);
      vi.mocked(prisma.conversation.count).mockResolvedValueOnce(1 as any);
      vi.mocked(prisma.contact.findMany).mockResolvedValueOnce([{ phone: '628111', name: 'Alice' }] as any);

      const { conversations } = await makeService().findAll('prof-1', {});
      const row = conversations[0] as any;

      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: 'prof-1', phone: { in: ['628111'] } } }),
      );
      expect(row.contactName).toBe('Alice');
      expect(row.contactPhone).toBe('628111');
      expect(row.lastMessage).toBeNull();
    });

    it("falls back to 'Group Chat' when the engine cannot resolve a JID-like group name", async () => {
      const gid = '120363-abc@g.us';
      const conv = {
        id: 'c3',
        profileId: 'prof-1',
        jid: gid,
        type: 'group',
        name: gid, // name === jid => treated as JID-like placeholder
        unreadCount: 0,
        _count: { messages: 1 },
        contact: null,
        messages: [{ id: 'g-last' }],
      };
      vi.mocked(prisma.conversation.findMany).mockResolvedValueOnce([conv] as any);
      vi.mocked(prisma.conversation.count).mockResolvedValueOnce(1 as any);
      const getById = vi.fn().mockRejectedValue(new Error('engine offline'));

      const { conversations } = await makeService({ getById }).findAll('prof-1', {});
      const row = conversations[0] as any;

      expect(getById).toHaveBeenCalledWith('prof-1', gid);
      expect(row.contactName).toBe('Group Chat');
    });
  });

  describe('findOne (not-found + ordering)', () => {
    it('throws NotFoundException when the conversation is missing', async () => {
      vi.mocked(prisma.conversation.findUnique).mockResolvedValueOnce(null as any);
      await expect(makeService().findOne('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns messages reversed into chronological order', async () => {
      // DB returns newest-first; the service reverses to oldest-first.
      vi.mocked(prisma.conversation.findUnique).mockResolvedValueOnce({
        id: 'c1',
        contact: null,
        messages: [{ id: 'm3' }, { id: 'm2' }, { id: 'm1' }],
      } as any);

      const conv = await makeService().findOne('c1');

      expect(conv.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });
  });

  describe('getMessages (cursor pagination)', () => {
    it('turns a `before` id into a timestamp `lt` filter and flags hasMore on a full page', async () => {
      const ts = new Date('2026-07-20T00:00:00.000Z');
      vi.mocked(prisma.message.findUnique).mockResolvedValueOnce({ timestamp: ts } as any);
      vi.mocked(prisma.message.findMany).mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }] as any);

      const res = await makeService().getMessages('c1', { before: 'cursor-msg', limit: 2 });

      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { id: 'cursor-msg' },
        select: { timestamp: true },
      });
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'c1', timestamp: { lt: ts } },
          take: 2,
        }),
      );
      expect(res.messages.map((m: any) => m.id)).toEqual(['a', 'b']); // reversed to chronological
      expect(res.hasMore).toBe(true); // returned count === requested limit
    });
  });
});

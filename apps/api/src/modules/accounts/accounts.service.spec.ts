// AccountsService Unit Tests
// Covers the self-heal logic of findAll() that backs profile creation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    workspace: { create: vi.fn() },
    account: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    profile: { create: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { AccountsService } from './accounts.service';

describe('AccountsService', () => {
  let service: AccountsService;

  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.workspace.create).mockReset();
    vi.mocked(prisma.account.findMany).mockReset();
    vi.mocked(prisma.account.create).mockReset();

    service = new AccountsService({} as any, {} as any);
  });

  describe('findAll', () => {
    it('returns [] when the user does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      expect(await service.findAll('missing')).toEqual([]);
    });

    it('creates a workspace and account when the organization has no workspace', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        organization: { id: 'org-1', workspaces: [] },
      } as any);
      vi.mocked(prisma.workspace.create).mockResolvedValueOnce({ id: 'ws-new' } as any);
      vi.mocked(prisma.account.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.account.create).mockResolvedValueOnce({
        id: 'acc-new',
        workspaceId: 'ws-new',
      } as any);

      const result = await service.findAll('user-1');

      expect(prisma.workspace.create).toHaveBeenCalledOnce();
      expect(prisma.account.create).toHaveBeenCalledOnce();
      expect(result).toEqual([{ id: 'acc-new', workspaceId: 'ws-new' }]);
    });

    it('auto-creates an account when the workspace exists but has none', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        organization: { id: 'org-1', workspaces: [{ id: 'ws-1' }] },
      } as any);
      vi.mocked(prisma.account.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.account.create).mockResolvedValueOnce({ id: 'acc-new' } as any);

      const result = await service.findAll('user-1');

      expect(prisma.workspace.create).not.toHaveBeenCalled();
      expect(prisma.account.create).toHaveBeenCalledOnce();
      expect(result).toEqual([{ id: 'acc-new' }]);
    });

    it('returns existing active accounts without creating anything', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        organization: { id: 'org-1', workspaces: [{ id: 'ws-1' }] },
      } as any);
      vi.mocked(prisma.account.findMany).mockResolvedValueOnce([{ id: 'acc-1' }] as any);

      const result = await service.findAll('user-1');

      expect(prisma.workspace.create).not.toHaveBeenCalled();
      expect(prisma.account.create).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 'acc-1' }]);
    });
  });

  describe('createProfile — engine selection', () => {
    const createdEngine = () => (vi.mocked(prisma.profile.create).mock.calls[0][0] as any).data.engine;

    beforeEach(() => {
      vi.mocked(prisma.account.findUnique).mockReset().mockResolvedValue({ id: 'a1', workspaceId: 'w1' } as any);
      vi.mocked(prisma.profile.create).mockReset().mockResolvedValue({} as any);
    });

    it('persists a valid engine from settings.engine (baileys)', async () => {
      await service.createProfile('a1', { displayName: 'x', settings: { engine: 'baileys' } });
      expect(createdEngine()).toBe('baileys');
    });

    it('honors dto.engine when settings.engine is absent (mock)', async () => {
      await service.createProfile('a1', { displayName: 'x', engine: 'mock' });
      expect(createdEngine()).toBe('mock');
    });

    it('falls back to whatsapp-web-js for an unknown engine', async () => {
      await service.createProfile('a1', { displayName: 'x', settings: { engine: 'evil-engine' } });
      expect(createdEngine()).toBe('whatsapp-web-js');
    });

    it('defaults to whatsapp-web-js when no engine is provided', async () => {
      await service.createProfile('a1', { displayName: 'x' });
      expect(createdEngine()).toBe('whatsapp-web-js');
    });
  });
});

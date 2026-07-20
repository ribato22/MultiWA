// Regression test for the empty-group-list bug (2026-07-20): the messages-page
// group picker went empty because GroupsService.getAll returned [] whenever the
// live whatsapp-web.js getGroups threw ("Get groups error: r" — a WhatsApp Web
// build whose group Store isn't hooked, even while send works). getAll now falls
// back to the groups persisted from message history, so the picker stays usable.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { conversation: { findMany: vi.fn() } },
}));
// Keep the heavy engine adapters (puppeteer/whatsapp-web.js) out of this unit test.
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../engine-commands/engine-commands.service', () => ({ EngineCommandsService: class {} }));
vi.mock('../../common/engine-host', () => ({ isWorkerEngine: vi.fn(() => false) }));

import { prisma } from '@multiwa/database';
import { GroupsService } from './groups.service';

function makeService(engine: any) {
  const engineManager = { getEngine: vi.fn(() => engine) } as any;
  const engineCommands = { groupOp: vi.fn() } as any;
  return new GroupsService(engineManager, engineCommands);
}

describe('GroupsService.getAll — resilient group list', () => {
  beforeEach(() => vi.mocked(prisma.conversation.findMany).mockReset());

  it('returns live engine groups when available and never touches the DB', async () => {
    const svc = makeService({
      getGroups: vi.fn().mockResolvedValue([{ id: '1@g.us', name: 'Live Group', participantCount: 3 }]),
    });
    const out = await svc.getAll('p1');
    expect(out).toEqual([expect.objectContaining({ id: '1@g.us', name: 'Live Group', participantsCount: 3 })]);
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it('falls back to stored group conversations when live getGroups throws', async () => {
    const svc = makeService({ getGroups: vi.fn().mockRejectedValue(new Error('r')) });
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      { jid: '120@g.us', name: 'Stored Group', type: 'group', createdAt: new Date() },
    ] as any);

    const out = await svc.getAll('p1');

    expect(out).toEqual([expect.objectContaining({ id: '120@g.us', name: 'Stored Group' })]);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ profileId: 'p1' }) }),
    );
  });

  it('falls back to the DB when live returns an empty list, defaulting a null name', async () => {
    const svc = makeService({ getGroups: vi.fn().mockResolvedValue([]) });
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      { jid: 'g@g.us', name: null, type: 'group', createdAt: new Date() },
    ] as any);

    const out = await svc.getAll('p1');

    expect(out[0].name).toBe('Group Chat');
  });
});

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
  // Captures the internal engine-degradation probe (live vs DB fallback).
  const emitted: { event: string; payload: any }[] = [];
  const eventEmitter = { emit: vi.fn((event: string, payload: any) => { emitted.push({ event, payload }); return true; }) } as any;
  const service = new GroupsService(engineManager, engineCommands, eventEmitter);
  (service as any).__emitted = emitted;
  return service;
}

const emittedSources = (svc: any): string[] =>
  (svc.__emitted as { event: string; payload: any }[])
    .filter((e) => e.event === 'internal.engine.group_fetch')
    .map((e) => e.payload.source);

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

// The engine-degradation probe: the alert keys on WHICH SOURCE served the list, so
// the silent Store break behind the 2026-07-30 incident becomes visible to
// monitoring instead of being just a log line.
describe('GroupsService.getAll — degradation probe', () => {
  beforeEach(() => vi.mocked(prisma.conversation.findMany).mockReset());

  it('reports source="live" when the engine answers', async () => {
    const svc = makeService({
      getGroups: vi.fn().mockResolvedValue([{ id: '1@g.us', name: 'Live Group', participantCount: 3 }]),
    });
    await svc.getAll('p1');
    expect(emittedSources(svc)).toEqual(['live']);
  });

  it('reports source="fallback" when the live call throws', async () => {
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([
      { id: 'c1', jid: '1@g.us', name: 'Stored Group', createdAt: new Date() },
    ] as any);
    const svc = makeService({ getGroups: vi.fn().mockRejectedValue(new Error('r')) });
    await svc.getAll('p1');
    expect(emittedSources(svc)).toEqual(['fallback']);
  });

  it('reports source="fallback" when the engine returns an empty list', async () => {
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([] as any);
    const svc = makeService({ getGroups: vi.fn().mockResolvedValue([]) });
    await svc.getAll('p1');
    expect(emittedSources(svc)).toEqual(['fallback']);
  });
});

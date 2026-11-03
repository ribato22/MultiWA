// GET /workspaces/:id lists the workspace's profiles: as on /profiles, where an announcement's file is kept stays
// inside the server.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { workspace: { findUnique: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService.findById', () => {
  it("answers with its profiles' settings without the announcement storage key", async () => {
    const settings = { callsAnnouncement: { storageKey: 'announcements/o1/p1/a.mp3', mimeType: 'audio/mpeg', durationSec: 4.2 } };
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ id: 'w1', profiles: [{ id: 'p1', settings }] } as any);
    const ws = await new WorkspacesService().findById('w1');
    expect(ws.profiles.map((p) => p.settings)).toEqual([{ callsAnnouncement: { mimeType: 'audio/mpeg', durationSec: 4.2 } }]);
  });
});

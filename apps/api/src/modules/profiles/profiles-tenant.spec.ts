// GET /profiles?workspaceId= must only ever list the caller's own workspaces. It used to take the
// workspaceId as given, so a user of one organization could list another organization's profiles.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { workspace: { findMany: vi.fn() }, profile: { findMany: vi.fn() } } }));
vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));

import { prisma } from '@multiwa/database';
import { TENANT_CHECK } from '../../common/tenant/require-tenant.decorator';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

const db = prisma as any;
const service = new ProfilesService({} as any, {} as any);
const listedWorkspaces = () => db.profile.findMany.mock.calls[0][0].where.workspaceId.in;

beforeEach(() => {
  db.workspace.findMany.mockReset().mockResolvedValue([{ id: 'ws-a1' }, { id: 'ws-a2' }]);
  db.profile.findMany.mockReset().mockResolvedValue([]);
});

describe('ProfilesService.findAll tenant scope', () => {
  it("lists nothing for another organization's workspace", async () => {
    await service.findAll('org-a', 'ws-b1');
    expect(db.workspace.findMany).toHaveBeenCalledWith({ where: { organizationId: 'org-a' }, select: { id: true } });
    expect(listedWorkspaces()).toEqual([]);
  });

  it('lists one own workspace when it is asked for', async () => {
    await service.findAll('org-a', 'ws-a2');
    expect(listedWorkspaces()).toEqual(['ws-a2']);
  });

  it('lists every own workspace when none is asked for', async () => {
    await service.findAll('org-a');
    expect(listedWorkspaces()).toEqual(['ws-a1', 'ws-a2']);
  });
});

describe('GET /profiles route', () => {
  it('has TenantGuard check the optional workspaceId query', () => {
    expect(Reflect.getMetadata(TENANT_CHECK, ProfilesController.prototype.findAll)).toContainEqual({
      from: 'query',
      key: 'workspaceId',
      resource: 'workspace',
      optional: true,
    });
  });
});

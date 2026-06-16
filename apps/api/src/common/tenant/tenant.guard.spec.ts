// TenantGuard Unit Tests
// Proves cross-tenant isolation: a resource that does not resolve within the
// caller's organization is rejected with 403; same-org access is allowed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    webhook: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
    broadcast: { findFirst: vi.fn() },
    automation: { findFirst: vi.fn() },
    template: { findFirst: vi.fn() },
    message: { findFirst: vi.fn() },
    scheduledMessage: { findFirst: vi.fn() },
    knowledgeDocument: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
    role: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { TenantGuard } from './tenant.guard';
import { TenantCheck } from './require-tenant.decorator';

function makeContext(req: any, checks?: TenantCheck[]) {
  const reflector: any = {
    getAllAndOverride: vi.fn().mockReturnValue(checks),
  };
  const ctx: any = {
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return { guard: new TenantGuard(reflector), ctx };
}

const ORG = 'org-1';
const profileCheck: TenantCheck = { from: 'body', key: 'profileId', resource: 'profile' };

describe('TenantGuard', () => {
  beforeEach(() => {
    vi.mocked(prisma.profile.findFirst).mockReset();
  });

  it('allows routes without @RequireTenant metadata', async () => {
    const { guard, ctx } = makeContext({ user: { organizationId: ORG }, body: {} }, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.profile.findFirst).not.toHaveBeenCalled();
  });

  it('allows same-org access and scopes the lookup by organizationId', async () => {
    vi.mocked(prisma.profile.findFirst).mockResolvedValue({ id: 'p1' } as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, body: { profileId: 'p1' } },
      [profileCheck],
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.profile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1', workspace: { organizationId: ORG } },
      }),
    );
  });

  it('rejects cross-tenant access with 403 (resource resolves to null for this org)', async () => {
    vi.mocked(prisma.profile.findFirst).mockResolvedValue(null as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, body: { profileId: 'other-org-profile' } },
      [profileCheck],
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the organization context is missing', async () => {
    const { guard, ctx } = makeContext({ user: {}, body: { profileId: 'p1' } }, [profileCheck]);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when a required id is absent', async () => {
    const { guard, ctx } = makeContext({ user: { organizationId: ORG }, body: {} }, [profileCheck]);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('skips an optional check when its id is absent', async () => {
    const { guard, ctx } = makeContext({ user: { organizationId: ORG }, query: {} }, [
      { ...profileCheck, from: 'query', optional: true },
    ]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.profile.findFirst).not.toHaveBeenCalled();
  });

  it('resolves non-profile resources through the profile->org chain', async () => {
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: 'c1' } as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, params: { id: 'c1' } },
      [{ from: 'param', key: 'id', resource: 'contact' }],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', profile: { workspace: { organizationId: ORG } } },
      }),
    );
  });

  it('scopes a workspace directly by organizationId', async () => {
    vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: 'w1' } as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, params: { id: 'w1' } },
      [{ from: 'param', key: 'id', resource: 'workspace' }],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1', organizationId: ORG } }),
    );
  });

  it('scopes an account through its workspace->org', async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({ id: 'a1' } as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, params: { accountId: 'a1' } },
      [{ from: 'param', key: 'accountId', resource: 'account' }],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', workspace: { organizationId: ORG } } }),
    );
  });

  it('scopes a role directly by organizationId', async () => {
    vi.mocked(prisma.role.findFirst).mockResolvedValue({ id: 'r1' } as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, params: { id: 'r1' } },
      [{ from: 'param', key: 'id', resource: 'role' }],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', organizationId: ORG } }),
    );
  });

  it('rejects a cross-tenant role with 403', async () => {
    vi.mocked(prisma.role.findFirst).mockResolvedValue(null as any);
    const { guard, ctx } = makeContext(
      { user: { organizationId: ORG }, params: { id: 'other-org-role' } },
      [{ from: 'param', key: 'id', resource: 'role' }],
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// The audit log list loads, and says it loaded, a bounded page whatever `limit` it is given, and its action filter is a
// prefix of the text typed, where a %, an _ or a \ is that character, no wildcard.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { auditLog: { findMany: vi.fn(), count: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { AuditService } from './audit.service';

const db = prisma as any;

describe('AuditService.query', () => {
  beforeEach(() => {
    db.auditLog.findMany.mockReset().mockResolvedValue([]);
    db.auditLog.count.mockReset().mockResolvedValue(0);
  });

  it.each([[undefined, 50], [20, 20], [100_000, 1000], [0.5, 50]])('a limit of %s loads and answers a page of %i', async (limit, take) => {
    const res = await new AuditService().query({ organizationId: 'o1', limit });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'o1' }, take }));
    expect(res.limit).toBe(take);
  });

  it('lists the actions that start with the prefix typed', async () => {
    await new AuditService().query({ organizationId: 'o1', action: 'auth' });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'o1', action: { startsWith: 'auth' } } }));
  });

  it("lists the actions that start with the prefix typed: a prefix's %, _ and \\ are no wildcards", async () => {
    await new AuditService().query({ organizationId: 'o1', action: '50%_off\\' });
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'o1', action: { startsWith: '50\\%\\_off\\\\' } } }));
    expect(db.auditLog.count).toHaveBeenCalledWith({ where: { organizationId: 'o1', action: { startsWith: '50\\%\\_off\\\\' } } });
  });
});

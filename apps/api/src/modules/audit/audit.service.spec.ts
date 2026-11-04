// The audit log list loads, and says it loaded, a bounded page whatever `limit` it is given.
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
});

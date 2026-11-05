// The organization's export (GET /account/export) carries its customers, with their links, notes and tags.
import { describe, expect, it, vi } from 'vitest';

const { customerFindMany } = vi.hoisted(() => ({ customerFindMany: vi.fn() }));
vi.mock('@multiwa/database', () => ({
  prisma: new Proxy({}, {
    get: (_, model) =>
      model === 'customer'
        ? { findMany: customerFindMany }
        : { findUnique: async () => ({ id: 'u1' }), findMany: async () => [] },
  }),
}));

import { GdprController } from './gdpr.controller';

describe('GdprController.exportData', () => {
  it("carries the organization's customers, with their links, notes and tags", async () => {
    const customers = [{
      id: 'c-1', externalId: '1234567890', displayName: 'Budi Santoso', tags: ['vip'],
      links: [{ id: 'l-1', phone: '6281100000001' }], notes: [{ id: 'n-1', body: 'Prefers a call after 16:00' }],
    }];
    customerFindMany.mockResolvedValue(customers);
    const exported: any = await new GdprController().exportData({ user: { id: 'u1', organizationId: 'org-1' } });
    expect(customerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' } }));
    expect(customerFindMany.mock.calls[0][0].select).toMatchObject({
      externalId: true, displayName: true, tags: true, manualFields: true,
      links: { select: expect.objectContaining({ phone: true, lastUsedAt: true }) },
      notes: { select: expect.objectContaining({ body: true, createdAt: true }) },
    });
    expect(exported.customers).toBe(customers);
    expect(exported.statistics.totalCustomers).toBe(1);
  });
});

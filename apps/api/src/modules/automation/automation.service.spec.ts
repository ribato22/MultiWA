// AutomationService.reorder. The tenant guard checks the profile named in the body, so every rule the order names
// must be that profile's: a rule of another profile, or of another organization, is never touched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    automation: { count: vi.fn(), update: vi.fn((args) => args), updateMany: vi.fn((args) => args) },
    $transaction: vi.fn(async (ops) => ops),
  },
}));

import { prisma } from '@multiwa/database';
import { AutomationService } from './automation.service';

const A = prisma.automation as any;
const transaction = prisma.$transaction as any;

describe('AutomationService.reorder', () => {
  const service = new AutomationService();

  beforeEach(() => vi.clearAllMocks());

  it("refuses an order naming a rule that is not the profile's, and changes nothing", async () => {
    A.count.mockResolvedValueOnce(1);
    await expect(service.reorder('p1', ['a1', 'rule-of-another-org'])).rejects.toThrow(NotFoundException);
    expect(A.count).toHaveBeenCalledWith({ where: { profileId: 'p1', id: { in: ['a1', 'rule-of-another-org'] } } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("sets the priorities in the order given, on the profile's rules only", async () => {
    A.count.mockResolvedValueOnce(2);
    await expect(service.reorder('p1', ['a2', 'a1'])).resolves.toEqual({ success: true });
    expect(A.updateMany.mock.calls.map(([args]: [unknown]) => args)).toEqual([
      { where: { id: 'a2', profileId: 'p1' }, data: { priority: 1 } },
      { where: { id: 'a1', profileId: 'p1' }, data: { priority: 2 } },
    ]);
    expect(A.update).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

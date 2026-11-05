// The template list searches the names of the profile's templates for the text typed, in any case; a %, an _ or a \ in
// it is that character, no wildcard.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { template: { findMany: vi.fn() } } }));

import { prisma } from '@multiwa/database';
import { TemplatesService } from './templates.service';

const db = prisma as any;

describe('TemplatesService.findAll', () => {
  beforeEach(() => {
    db.template.findMany.mockReset().mockResolvedValue([]);
  });

  it('searches the names of the profile for the text typed', async () => {
    await new TemplatesService().findAll('p1', { search: 'welcome' });
    expect(db.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: 'p1', OR: [{ name: { contains: 'welcome', mode: 'insensitive' } }] } }),
    );
  });

  it("searches for the text typed: a search's %, _ and \\ are no wildcards", async () => {
    await new TemplatesService().findAll('p1', { search: '50%_off\\' });
    expect(db.template.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: 'p1', OR: [{ name: { contains: '50\\%\\_off\\\\', mode: 'insensitive' } }] } }),
    );
  });

  it('lists every template of the profile without a search', async () => {
    await new TemplatesService().findAll('p1', {});
    expect(db.template.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { profileId: 'p1' } }));
  });
});

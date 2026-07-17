// SessionsService.validateAndTouch tests — the revocation check run on every
// authenticated request.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@multiwa/database';
import { SessionsService } from './sessions.service';

const service = new SessionsService();
const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('SessionsService.validateAndTouch', () => {
  beforeEach(() => {
    vi.mocked(prisma.session.findUnique).mockReset();
    vi.mocked(prisma.session.update).mockReset().mockResolvedValue({} as any);
  });

  it('returns false when the session is missing (logged out / revoked)', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue(null as any);
    expect(await service.validateAndTouch('tok')).toBe(false);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('returns false when the session has expired', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 's1',
      expiresAt: past(),
      lastActiveAt: new Date(),
    } as any);
    expect(await service.validateAndTouch('tok')).toBe(false);
  });

  it('returns true and does NOT write when activity is recent (throttled)', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 's1',
      expiresAt: future(),
      lastActiveAt: new Date(), // just now → within throttle window
    } as any);
    expect(await service.validateAndTouch('tok')).toBe(true);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('returns true and refreshes lastActiveAt when activity is stale', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      id: 's1',
      expiresAt: future(),
      lastActiveAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago → stale
    } as any);
    expect(await service.validateAndTouch('tok')).toBe(true);
    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
  });
});

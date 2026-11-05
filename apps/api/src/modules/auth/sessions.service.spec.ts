// SessionsService.validateAndTouch tests — the revocation check run on every
// authenticated request.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import type { EventsGateway } from '../events/events.gateway';
import { SessionsService } from './sessions.service';

const gateway = { disconnectSession: vi.fn(), disconnectOtherSessions: vi.fn() };
const service = new SessionsService(gateway as unknown as EventsGateway);
/** The sessions table's key of an access token. */
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
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

// Revoking a session closes the sockets it opened at once, after the session is gone (the sweep is only the safety net).
describe('SessionsService revocation closes the sockets of the session', () => {
  beforeEach(() => {
    gateway.disconnectSession.mockReset();
    gateway.disconnectOtherSessions.mockReset();
    vi.mocked(prisma.session.findFirst).mockReset();
    vi.mocked(prisma.session.delete).mockReset().mockResolvedValue({} as any);
    vi.mocked(prisma.session.deleteMany).mockReset().mockResolvedValue({ count: 2 } as any);
  });

  it('logout: the sockets of that token, once its session is deleted', async () => {
    const order: string[] = [];
    vi.mocked(prisma.session.deleteMany).mockImplementationOnce((async () => (order.push('delete'), { count: 1 })) as any);
    gateway.disconnectSession.mockImplementationOnce(() => void order.push('disconnect'));

    await service.removeSessionByToken('tok');

    expect(gateway.disconnectSession).toHaveBeenCalledWith(hash('tok'));
    expect(order).toEqual(['delete', 'disconnect']);
  });

  it("revoking one session: the sockets of that session's token, once it is deleted", async () => {
    const order: string[] = [];
    vi.mocked(prisma.session.findFirst).mockResolvedValueOnce({ id: 's1', userId: 'u1', tokenHash: hash('other-device') } as any);
    vi.mocked(prisma.session.delete).mockImplementationOnce((async () => void order.push('delete')) as any);
    gateway.disconnectSession.mockImplementationOnce(() => void order.push('disconnect'));

    await service.revokeSession('u1', 's1');

    expect(gateway.disconnectSession).toHaveBeenCalledWith(hash('other-device'));
    expect(order).toEqual(['delete', 'disconnect']);
  });

  it('revoking a session that is not the caller\'s closes no socket', async () => {
    vi.mocked(prisma.session.findFirst).mockResolvedValueOnce(null);
    await expect(service.revokeSession('u1', 's-of-someone-else')).rejects.toThrow(NotFoundException);
    expect(prisma.session.delete).not.toHaveBeenCalled();
    expect(gateway.disconnectSession).not.toHaveBeenCalled();
  });

  it("revoking all the others: the user's dashboard sockets but the current session's, once they are deleted", async () => {
    const order: string[] = [];
    vi.mocked(prisma.session.deleteMany).mockImplementationOnce((async () => (order.push('delete'), { count: 2 })) as any);
    gateway.disconnectOtherSessions.mockImplementationOnce(() => void order.push('disconnect'));

    await expect(service.revokeAllSessions('u1', 'current-token')).resolves.toBe(2);

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', tokenHash: { not: hash('current-token') } } });
    expect(gateway.disconnectOtherSessions).toHaveBeenCalledWith('u1', hash('current-token'));
    expect(order).toEqual(['delete', 'disconnect']);
  });

  it('revoking all with no current token closes all of the user\'s dashboard sockets', async () => {
    await service.revokeAllSessions('u1');
    expect(gateway.disconnectOtherSessions).toHaveBeenCalledWith('u1', undefined);
  });

  it('revoking all for no user deletes nothing and closes nothing', async () => {
    await expect(service.revokeAllSessions('')).resolves.toBe(0);
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(gateway.disconnectOtherSessions).not.toHaveBeenCalled();
  });
});

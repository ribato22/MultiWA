// Unit spec for the worker MessageProcessor. Locks the send-job routing contract:
// a job is only marked QUEUED (handed to the gateway) when its profile exists AND
// is CONNECTED; every other path (missing profile, wrong status, DB error) must
// mark the message FAILED with the error captured in metadata and re-throw so BullMQ
// retries. Prisma is mocked (no DB) — the processor calls createPrismaClient() at
// module load, so the mock returns a STABLE object shared with the exported `prisma`.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => {
  const mockPrisma = {
    profile: { findUnique: vi.fn() },
    message: { update: vi.fn() },
  };
  // Same object for both entry points so the source's createPrismaClient() and the
  // `prisma` we import in tests point at one shared set of vi.fn() spies.
  return { createPrismaClient: () => mockPrisma, prisma: mockPrisma };
});

import { prisma } from '@multiwa/database';
import { MessageProcessor, type MessageJob } from './message.processor';

const findUnique = () => vi.mocked(prisma.profile.findUnique);
const updateMsg = () => vi.mocked(prisma.message.update);

function makeJob(over: Partial<MessageJob> = {}) {
  return {
    data: {
      profileId: 'prof-1',
      messageId: 'msg-1',
      to: '628123456789@c.us',
      type: 'chat',
      content: { body: 'hi' },
      ...over,
    },
  } as any;
}

describe('MessageProcessor.process', () => {
  const processor = new MessageProcessor();

  beforeEach(() => {
    findUnique().mockReset();
    updateMsg().mockReset();
    updateMsg().mockResolvedValue({} as any);
  });

  it('marks the message QUEUED and returns queued_for_gateway when the profile is CONNECTED', async () => {
    findUnique().mockResolvedValueOnce({ id: 'prof-1', status: 'CONNECTED' } as any);

    const result = await processor.process(makeJob());

    // Looked the profile up by the job's profileId.
    expect(findUnique()).toHaveBeenCalledWith({ where: { id: 'prof-1' } });
    // The ONLY write is the QUEUED status update on the right message.
    expect(updateMsg()).toHaveBeenCalledTimes(1);
    expect(updateMsg()).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'QUEUED' },
    });
    // Result echoes routing metadata for the gateway.
    expect(result).toEqual({
      success: true,
      profileId: 'prof-1',
      messageId: 'msg-1',
      to: '628123456789@c.us',
      type: 'chat',
      status: 'queued_for_gateway',
    });
  });

  it('throws and marks the message FAILED (with error metadata) when the profile is missing', async () => {
    findUnique().mockResolvedValueOnce(null as any);

    await expect(processor.process(makeJob())).rejects.toThrow('Profile not connected');

    // Never queued; the single write is the FAILED update carrying the reason.
    expect(updateMsg()).toHaveBeenCalledTimes(1);
    expect(updateMsg()).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'FAILED',
        metadata: { error: 'Profile not connected' },
      },
    });
    // It must NOT have queued the message.
    expect(updateMsg()).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'QUEUED' } }),
    );
  });

  it('treats any non-CONNECTED status as not connected and fails the message', async () => {
    findUnique().mockResolvedValueOnce({ id: 'prof-1', status: 'DISCONNECTED' } as any);

    await expect(processor.process(makeJob())).rejects.toThrow('Profile not connected');

    expect(updateMsg()).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'FAILED', metadata: { error: 'Profile not connected' } },
    });
  });

  it('re-throws the ORIGINAL db error and still records it as FAILED when the QUEUED update fails', async () => {
    findUnique().mockResolvedValueOnce({ id: 'prof-1', status: 'CONNECTED' } as any);
    const boom = new Error('db write timeout');
    // First update (QUEUED) rejects; second update (FAILED, in catch) resolves.
    updateMsg().mockRejectedValueOnce(boom).mockResolvedValueOnce({} as any);

    await expect(processor.process(makeJob())).rejects.toBe(boom);

    expect(updateMsg()).toHaveBeenCalledTimes(2);
    // The catch block persists the caught error message.
    expect(updateMsg()).toHaveBeenLastCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'FAILED', metadata: { error: 'db write timeout' } },
    });
  });

  it('records "Unknown error" when a non-Error value is thrown', async () => {
    // findUnique rejects with a bare string (not an Error instance).
    findUnique().mockRejectedValueOnce('nope' as any);

    await expect(processor.process(makeJob())).rejects.toBe('nope');

    expect(updateMsg()).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'FAILED', metadata: { error: 'Unknown error' } },
    });
  });
});

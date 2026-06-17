// WebhookDispatcherService unit tests
// Proves: known events enqueue one job per subscribed webhook with idempotency
// jobId; unknown events and payloads without profileId are skipped.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { webhook: { findMany: vi.fn() } },
}));

import { prisma } from '@multiwa/database';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { AppEvents } from '@multiwa/core';

function makeService() {
  const queue = { add: vi.fn().mockResolvedValue({}) };
  const svc = new WebhookDispatcherService({} as any, queue as any);
  return { svc, queue };
}

// dispatch is private; call it directly via the instance.
const dispatch = (svc: WebhookDispatcherService, event: string, payload: any) =>
  (svc as any).dispatch(event, payload);

describe('WebhookDispatcherService', () => {
  beforeEach(() => {
    vi.mocked(prisma.webhook.findMany).mockReset();
  });

  it('enqueues one job per subscribed webhook for a known event', async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([{ id: 'w1' }, { id: 'w2' }] as any);
    const { svc, queue } = makeService();

    await dispatch(svc, AppEvents.MESSAGE.RECEIVED, { profileId: 'p1', id: 'm1' });

    expect(prisma.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: 'p1', enabled: true, events: { has: 'message.received' } },
      }),
    );
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0][0]).toBe('deliver');
    expect(queue.add.mock.calls[0][1]).toMatchObject({ webhookId: 'w1', event: 'message.received' });
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      jobId: 'w1-message.received-m1',
      attempts: 5,
      backoff: { type: 'exponential', delay: 30000 },
    });
  });

  it('skips unknown events (no prisma query, no enqueue)', async () => {
    const { svc, queue } = makeService();
    await dispatch(svc, 'not.a.real.event', { profileId: 'p1' });
    expect(prisma.webhook.findMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips events without a profileId', async () => {
    const { svc, queue } = makeService();
    await dispatch(svc, AppEvents.MESSAGE.RECEIVED, { id: 'm1' });
    expect(prisma.webhook.findMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('omits jobId for connection events without a messageId', async () => {
    vi.mocked(prisma.webhook.findMany).mockResolvedValue([{ id: 'w1' }] as any);
    const { svc, queue } = makeService();
    await dispatch(svc, AppEvents.CONNECTION.READY, { profileId: 'p1', phone: '628' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2].jobId).toBeUndefined();
  });
});

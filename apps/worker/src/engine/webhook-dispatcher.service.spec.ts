// Unit spec for the worker's WorkerWebhookDispatcherService — mirrors the API
// dispatcher: it subscribes to the engine event bus and enqueues a 'deliver'
// webhook job ONLY for enabled webhooks whose `events` list subscribes to the
// fired event. Locks the fan-out contract: right job for a subscribed event,
// nothing for an unknown/disabled/unsubscribed one, and no crash on a DB blip.
//
// Prisma + the BullMQ queue are mocked (no DB, no Redis). The real APP_EVENT_SET
// from @multiwa/core (aliased to source) is used so the event-name guard is real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock — the service imports `prisma` from '@multiwa/database' at module
// load. Only webhook.findMany is used; createPrismaClient is provided defensively.
vi.mock('@multiwa/database', () => {
  const prisma = { webhook: { findMany: vi.fn() } };
  return { prisma, createPrismaClient: () => prisma };
});

import { prisma } from '@multiwa/database';
import {
  WorkerWebhookDispatcherService,
  WORKER_WEBHOOK_QUEUE,
} from './webhook-dispatcher.service';

const findMany = () => vi.mocked(prisma.webhook.findMany);

// Flush the fire-and-forget `void this.dispatch(...)` microtask chain.
const flush = () => new Promise((r) => setImmediate(r));

function makeService() {
  const onAny = vi.fn();
  const eventEmitter = { onAny } as any;
  const queueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
  const webhookQueue = { add: queueAdd } as any;
  const service = new WorkerWebhookDispatcherService(eventEmitter, webhookQueue);
  return { service, onAny, queueAdd };
}

describe('WorkerWebhookDispatcherService', () => {
  beforeEach(() => {
    findMany().mockReset();
  });

  it('exposes a stable DI token for the worker webhook queue', () => {
    expect(WORKER_WEBHOOK_QUEUE).toBe('WORKER_WEBHOOK_QUEUE');
  });

  it('subscribes to the engine event bus once on module init', () => {
    const { service, onAny } = makeService();
    service.onModuleInit();
    expect(onAny).toHaveBeenCalledTimes(1);
    expect(onAny.mock.calls[0][0]).toBeInstanceOf(Function);
  });

  it('enqueues a deliver job for a subscribed+enabled webhook, filtering on enabled:true and events.has', async () => {
    const { service, queueAdd } = makeService();
    findMany().mockResolvedValueOnce([{ id: 'wh_1' }] as any);
    const payload = { profileId: 'p1', id: 'MSG_1', from: '628123@c.us', body: 'hi' };

    await (service as any).dispatch('message.received', payload);

    // The query itself is the "only enabled + only subscribed" contract.
    expect(findMany()).toHaveBeenCalledWith({
      where: { profileId: 'p1', enabled: true, events: { has: 'message.received' } },
      select: { id: true },
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      { webhookId: 'wh_1', event: 'message.received', payload },
      expect.objectContaining({
        jobId: 'wh_1-message.received-MSG_1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: 200,
        removeOnFail: 100,
      }),
    );
  });

  it('does NOTHING for a known event when no enabled/subscribed webhook matches', async () => {
    const { service, queueAdd } = makeService();
    findMany().mockResolvedValueOnce([] as any);

    await (service as any).dispatch('message.sent', { profileId: 'p1', id: 'M2' });

    // It queried (with the enabled+events filter) but enqueued nothing.
    expect(findMany()).toHaveBeenCalledTimes(1);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('skips unknown/non-canonical events without ever querying the DB', async () => {
    const { service, queueAdd } = makeService();

    // Colon channel name + a bogus dot name — neither is in APP_EVENT_SET.
    await (service as any).dispatch('message:received', { profileId: 'p1', id: 'x' });
    await (service as any).dispatch('totally.made.up', { profileId: 'p1', id: 'x' });

    expect(findMany()).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('skips events with no profileId (cannot scope the webhook lookup)', async () => {
    const { service, queueAdd } = makeService();

    await (service as any).dispatch('message.received', { id: 'no-profile' });

    expect(findMany()).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('fans out one job per matching webhook and omits jobId when there is no message id', async () => {
    const { service, queueAdd } = makeService();
    findMany().mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }] as any);

    await (service as any).dispatch('connection.ready', { profileId: 'p1' });

    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd.mock.calls.map((c) => (c[1] as any).webhookId)).toEqual(['a', 'b']);
    // No messageId → jobId must be undefined (no dedup key).
    expect((queueAdd.mock.calls[0][2] as any).jobId).toBeUndefined();
  });

  it('derives the message id from payload.messageId when payload.id is absent', async () => {
    const { service, queueAdd } = makeService();
    findMany().mockResolvedValueOnce([{ id: 'wh_9' }] as any);

    await (service as any).dispatch('message.delivered', { profileId: 'p1', messageId: 'WA_42' });

    expect((queueAdd.mock.calls[0][2] as any).jobId).toBe('wh_9-message.delivered-WA_42');
  });

  it('swallows a prisma failure (never crashes the event loop) and enqueues nothing', async () => {
    const { service, queueAdd } = makeService();
    findMany().mockRejectedValueOnce(new Error('db down'));

    await expect(
      (service as any).dispatch('message.received', { profileId: 'p1', id: 'boom' }),
    ).resolves.toBeUndefined();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('routes an emitted bus event (incl. array event names joined by ".") through to the queue', async () => {
    const { service, onAny, queueAdd } = makeService();
    service.onModuleInit();
    const handler = onAny.mock.calls[0][0] as (e: string | string[], p: unknown) => void;
    findMany().mockResolvedValueOnce([{ id: 'wh_x' }] as any);

    // EventEmitter2 wildcard mode can hand the segments as an array.
    handler(['message', 'received'], { profileId: 'p1', id: 'MID' });
    await flush();

    expect(findMany()).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ events: { has: 'message.received' } }) }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({ webhookId: 'wh_x', event: 'message.received' }),
      expect.anything(),
    );
  });
});

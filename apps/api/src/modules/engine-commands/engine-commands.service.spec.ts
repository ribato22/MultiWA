// EngineCommandsService unit tests — proves result-bearing commands enqueue with
// request/reply (waitUntilFinished) and fire-and-forget commands just enqueue.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { EngineCommandsService } from './engine-commands.service';

function makeService(opts: { ready?: boolean; result?: any } = {}) {
  const waitUntilFinished = vi.fn().mockResolvedValue(opts.result ?? { status: 'connecting' });
  const queue = { add: vi.fn().mockResolvedValue({ waitUntilFinished }) };
  const config = { get: vi.fn() };
  const svc = new EngineCommandsService(queue as any, config as any);
  // Bypass onModuleInit (which would open a real Redis connection); simulate the
  // worker-mode "ready" client by injecting a stub QueueEvents.
  if (opts.ready ?? true) (svc as any).queueEvents = {};
  return { svc, queue, waitUntilFinished };
}

describe('EngineCommandsService', () => {
  let s: ReturnType<typeof makeService>;
  beforeEach(() => {
    s = makeService();
  });

  it('connectProfile enqueues connect-profile and awaits the result', async () => {
    const result = await s.svc.connectProfile('p1');
    expect(s.queue.add).toHaveBeenCalledWith(
      'connect-profile',
      { profileId: 'p1' },
      expect.objectContaining({ jobId: expect.stringMatching(/^connect-profile:p1:/), attempts: 1 }),
    );
    expect(s.waitUntilFinished).toHaveBeenCalled();
    expect(result).toEqual({ status: 'connecting' });
  });

  it('groupOp passes op + params and awaits result', async () => {
    await s.svc.groupOp('p1', 'create', { name: 'G', participants: ['628'] });
    expect(s.queue.add).toHaveBeenCalledWith(
      'group-op',
      { profileId: 'p1', op: 'create', params: { name: 'G', participants: ['628'] } },
      expect.objectContaining({ attempts: 1 }),
    );
    expect(s.waitUntilFinished).toHaveBeenCalled();
  });

  it('presenceUpdate is fire-and-forget (no waitUntilFinished)', async () => {
    await s.svc.presenceUpdate('p1', '628@s.whatsapp.net', 'composing');
    expect(s.queue.add).toHaveBeenCalledWith(
      'presence-update',
      { profileId: 'p1', to: '628@s.whatsapp.net', state: 'composing' },
      expect.objectContaining({ removeOnComplete: true }),
    );
    expect(s.waitUntilFinished).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailable for result commands when the client is not ready', async () => {
    const { svc } = makeService({ ready: false });
    await expect(svc.connectProfile('p1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

// EngineCommandsService unit tests — proves result-bearing commands enqueue with
// request/reply (waitUntilFinished) and fire-and-forget commands just enqueue.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AGENT_REJECT_TIMEOUT_MS } from '@multiwa/engine-runtime';
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
      expect.objectContaining({ jobId: expect.stringMatching(/^connect-profile-p1-/), attempts: 1 }),
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

  it('rejectCall and createCallLink are request/reply commands', async () => {
    await s.svc.rejectCall('p1', 'c1');
    expect(s.queue.add).toHaveBeenCalledWith('reject-call', { profileId: 'p1', callId: 'c1' }, expect.objectContaining({ attempts: 1 }));
    await s.svc.createCallLink('p1', 'video');
    expect(s.queue.add).toHaveBeenCalledWith('create-call-link', { profileId: 'p1', type: 'video' }, expect.objectContaining({ attempts: 1 }));
    expect(s.waitUntilFinished).toHaveBeenCalledTimes(2);
  });

  // The runtime bounds an agent's reject at AGENT_REJECT_TIMEOUT_MS (25 s) and holds the call until then; the REST layer
  // gives up at 30 s (CallsService) and the worker's command lock is 40 s. The wait for the worker sits between the
  // first two, so the runtime lets go of the call first (its ENGINE_TIMEOUT comes back as the job's failure) in both
  // engine modes, not 5 s after the agent was answered 504.
  it('waits for a call command longer than the runtime bounds a reject, and shorter than the REST layer does', async () => {
    await s.svc.rejectCall('p1', 'c1');
    await s.svc.createCallLink('p1', 'voice');
    const waits = s.waitUntilFinished.mock.calls.map((c) => c[1]);
    expect(waits).toEqual([28_000, 28_000]);
    for (const wait of waits) {
      expect(wait).toBeGreaterThan(AGENT_REJECT_TIMEOUT_MS);
      expect(wait).toBeLessThan(30_000);
    }
  });

  describe('job ids', () => {
    // BullMQ drops a job whose id exists: two commands in the same millisecond with the same id would be one job,
    // and the second request would be answered with the result of the first (or none).
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T09:00:00.000Z') });
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const ids = () => s.queue.add.mock.calls.map((c) => c[2].jobId);

    it('reject-call carries the call: two calls rejected in the same millisecond are two jobs', async () => {
      await s.svc.rejectCall('p1', 'c1');
      await s.svc.rejectCall('p1', 'c2');
      const [first, second] = ids();
      expect(first).toBe(`reject-call-p1-c1-${Date.now()}`);
      expect(second).toBe(`reject-call-p1-c2-${Date.now()}`);
    });

    it('reject-call keeps the time: asking again later is a new job, not the failed one still kept', async () => {
      await s.svc.rejectCall('p1', 'c1');
      vi.setSystemTime(Date.now() + 1);
      await s.svc.rejectCall('p1', 'c1');
      const [first, second] = ids();
      expect(first).not.toBe(second);
    });

    it('create-call-link has a random part: two links asked for in the same millisecond are two jobs', async () => {
      await s.svc.createCallLink('p1', 'voice');
      await s.svc.createCallLink('p1', 'voice');
      const [first, second] = ids();
      expect(first).toMatch(new RegExp(`^create-call-link-p1-${Date.now()}-[0-9a-f-]{36}$`));
      expect(second).toMatch(new RegExp(`^create-call-link-p1-${Date.now()}-[0-9a-f-]{36}$`));
      expect(first).not.toBe(second);
    });

    it('every other command keeps <name>-<profile>-<time>', async () => {
      await s.svc.connectProfile('p1');
      await s.svc.getEngineStatus('p1');
      expect(ids()).toEqual([`connect-profile-p1-${Date.now()}`, `get-status-p1-${Date.now()}`]);
    });
  });
});

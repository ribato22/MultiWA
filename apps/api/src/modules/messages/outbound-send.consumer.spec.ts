// Durable outbound send — MessagesService.deliverQueued unit tests.
// Covers: success, retry vs final-failure on a disconnected profile, permanent
// daily-limit failure (no retry), and transient-error retry vs last-attempt fail.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: { message: { update: vi.fn(), findUnique: vi.fn() } },
}));

// Stub the engine-manager module so importing MessagesService does not pull in
// @multiwa/engines -> baileys -> libsignal (an optional native dep absent in CI/dev).
vi.mock('../profiles/engine-manager.service', () => ({
  EngineManagerService: class {},
}));

import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';
import { AppEvents } from '@multiwa/core';
import { OutboundSendJob } from './outbound-send';

const JOB: OutboundSendJob = {
  messageDbId: 'm1',
  profileId: 'p1',
  to: '628111@s.whatsapp.net',
  type: 'text',
  content: { text: 'hello' },
};

function makeService(over: { engine?: any; gate?: any } = {}) {
  const engine = over.engine ?? { sendText: vi.fn().mockResolvedValue({ messageId: 'wa-123' }) };
  const engineManager = { getEngine: vi.fn().mockReturnValue(over.engine === null ? null : engine) };
  // default gate just runs the sendFn (proves dispatchToEngine is reached)
  const sendGate = over.gate ?? { executeWithGate: vi.fn((_pid: string, fn: () => Promise<any>) => fn()) };
  const eventEmitter = { emit: vi.fn() };
  const queue = { add: vi.fn() };
  const engineCommands = {};
  const svc = new MessagesService(engineManager as any, sendGate as any, eventEmitter as any, queue as any, engineCommands as any);
  return { svc, engine, engineManager, sendGate, eventEmitter };
}

describe('MessagesService.deliverQueued', () => {
  beforeEach(() => {
    vi.mocked(prisma.message.update).mockReset().mockResolvedValue({} as any);
    // deliverQueued reads the persisted lane to gate cold vs service.
    vi.mocked(prisma.message.findUnique).mockReset().mockResolvedValue({ lane: null } as any);
  });

  it('sends through the gate and marks the message sent + emits message.sent', async () => {
    const { svc, engine, eventEmitter } = makeService();
    await svc.deliverQueued(JOB, false);

    expect(engine.sendText).toHaveBeenCalledWith('628111@s.whatsapp.net', 'hello', { quotedMessageId: undefined });
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'sent', messageId: 'wa-123' }) }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.SENT, expect.objectContaining({ messageId: 'm1', waMessageId: 'wa-123' }));
  });

  it('throws (to retry) when the profile is not connected and it is not the last attempt', async () => {
    const { svc } = makeService({ engine: null });
    await expect(svc.deliverQueued(JOB, false)).rejects.toThrow(/not connected/);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('marks failed (no throw) when not connected on the last attempt', async () => {
    const { svc, eventEmitter } = makeService({ engine: null });
    await expect(svc.deliverQueued(JOB, true)).resolves.toBeUndefined();
    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'failed' } }));
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, expect.objectContaining({ messageId: 'm1', error: 'Profile not connected' }));
  });

  it('marks failed without retry on a daily-limit 429 (permanent)', async () => {
    const gate = {
      executeWithGate: vi.fn().mockRejectedValue(
        new HttpException({ error: 'DAILY_LIMIT_REACHED' }, HttpStatus.TOO_MANY_REQUESTS),
      ),
    };
    const { svc, eventEmitter } = makeService({ gate });
    await expect(svc.deliverQueued(JOB, false)).resolves.toBeUndefined(); // not last attempt, but still no retry
    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'failed' } }));
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, expect.objectContaining({ error: 'DAILY_LIMIT_REACHED' }));
  });

  it('rethrows a transient error when not the last attempt (BullMQ retries)', async () => {
    const gate = { executeWithGate: vi.fn().mockRejectedValue(new Error('engine boom')) };
    const { svc } = makeService({ gate });
    await expect(svc.deliverQueued(JOB, false)).rejects.toThrow('engine boom');
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('marks failed on a transient error on the last attempt', async () => {
    const gate = { executeWithGate: vi.fn().mockRejectedValue(new Error('engine boom')) };
    const { svc, eventEmitter } = makeService({ gate });
    await expect(svc.deliverQueued(JOB, true)).resolves.toBeUndefined();
    expect(prisma.message.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'failed' } }));
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, expect.objectContaining({ error: 'engine boom' }));
  });
});

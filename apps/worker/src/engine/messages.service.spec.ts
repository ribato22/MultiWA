// WorkerMessagesService: a send that did not happen is never reported as sent.
//
// With ENGINE_HOST=worker the automation replies go out through this in-process
// send path. Two failures used to look like success to the rule engine:
//   - the profile had no live engine: the row was left `pending` and the answer
//     was { success: true, status: 'pending' }. Nothing ever resends a `pending`
//     row, so the reply was lost.
//   - the engine answered { success: false } (engine sends return it, they do not
//     throw: client not ready, a stale group id): the row was kept as it was and
//     the answer was { success: true, status: 'sent' } with a message.sent event.
// Mirrors the API's queueMessage (send-disconnected-profile.spec.ts).
// Also: a queued send that timed out is failed, not retried (it may still be delivered).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

vi.mock('@multiwa/database', () => {
  const prisma = {
    profile: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  };
  return { prisma, createPrismaClient: () => prisma };
});

// The lane classifier reads the database; its answer is irrelevant to these guards.
vi.mock('@multiwa/engine-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@multiwa/engine-runtime')>()),
  classifyColdSend: vi.fn().mockResolvedValue(false),
}));

// Keep @multiwa/engines -> baileys -> libsignal (an optional native dep) out of the import graph.
vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { WorkerMessagesService } from './messages.service';

const DTO = { profileId: 'p1', to: '628123456789', text: 'secret-body-text' };

function makeService(engine?: unknown) {
  const engineManager = { getEngine: vi.fn().mockReturnValue(engine) };
  const sendGate = { executeWithGate: vi.fn((_profileId: string, send: () => Promise<unknown>) => send()) };
  const eventEmitter = { emit: vi.fn() };
  const svc = new WorkerMessagesService(engineManager as any, sendGate as any, eventEmitter as any);
  return { svc, sendGate, eventEmitter };
}

beforeEach(() => {
  vi.mocked(prisma.profile.findUnique).mockReset().mockResolvedValue({ id: 'p1' } as any);
  vi.mocked(prisma.conversation.findFirst).mockReset().mockResolvedValue({ id: 'c1' } as any);
  vi.mocked(prisma.conversation.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.message.create).mockReset().mockResolvedValue({ id: 'm1' } as any);
  vi.mocked(prisma.message.update).mockReset().mockResolvedValue({} as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkerMessagesService: send through a profile with no live engine', () => {
  it('answers the soft failure instead of { success: true, status: "pending" }', async () => {
    const { svc, sendGate } = makeService(undefined);

    const res = await svc.sendText(DTO);

    expect(res).toEqual({
      success: false,
      messageId: 'm1',
      conversationId: 'c1',
      status: 'failed',
      error: 'Profile not connected',
    });
    expect(sendGate.executeWithGate).not.toHaveBeenCalled();
  });

  it('marks the message row failed (not left pending) and emits message.failed', async () => {
    const { svc, eventEmitter } = makeService(undefined);

    await svc.sendText(DTO);

    expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'failed' } });
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, {
      profileId: 'p1',
      messageId: 'm1',
      to: '628123456789@s.whatsapp.net',
      type: 'text',
      error: 'Profile not connected',
    });
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(AppEvents.MESSAGE.SENT, expect.anything());
  });

  it('logs one warn line that carries ids only, never the recipient or the body', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = makeService(undefined);

    await svc.sendText(DTO);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('m1');
    expect(line).not.toContain('628123456789');
    expect(line).not.toContain('secret-body-text');
  });
});

describe('WorkerMessagesService: an engine that answers { success: false }', () => {
  const notReady = () => ({ sendText: vi.fn().mockResolvedValue({ success: false, error: 'Client not ready' }) });

  it('answers the soft failure instead of { success: true, status: "sent" }', async () => {
    const { svc } = makeService(notReady());

    const res = await svc.sendText(DTO);

    expect(res).toEqual({
      success: false,
      messageId: 'm1',
      conversationId: 'c1',
      status: 'failed',
      error: 'Client not ready',
    });
  });

  it('marks the message row failed and emits message.failed, never message.sent', async () => {
    const { svc, eventEmitter } = makeService(notReady());

    await svc.sendText(DTO);

    expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'failed' } });
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, {
      profileId: 'p1',
      messageId: 'm1',
      to: '628123456789@s.whatsapp.net',
      type: 'text',
      error: 'Client not ready',
    });
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(AppEvents.MESSAGE.SENT, expect.anything());
  });
});

describe('WorkerMessagesService.deliverQueued: a send that timed out', () => {
  it('marks it failed instead of letting BullMQ retry it, as the engine may still deliver it', async () => {
    vi.mocked(prisma.message.findUnique).mockReset().mockResolvedValue({ lane: null } as any);
    const sendGate = {
      executeWithGate: vi.fn().mockRejectedValue(new HttpException({ error: 'SEND_TIMEOUT' }, HttpStatus.GATEWAY_TIMEOUT)),
    };
    const eventEmitter = { emit: vi.fn() };
    const svc = new WorkerMessagesService({ getEngine: () => ({}) } as any, sendGate as any, eventEmitter as any);
    const job = { messageDbId: 'm1', profileId: 'p1', to: '628123456789@s.whatsapp.net', type: 'text', content: { text: 'x' } };

    await expect(svc.deliverQueued(job, false)).resolves.toBeUndefined(); // not the last attempt, still no retry

    expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'failed' } });
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, expect.objectContaining({ messageId: 'm1', error: 'SEND_TIMEOUT' }));
  });
});

describe('WorkerMessagesService.deliverQueued: an engine that answers { success: false }', () => {
  it('marks the row failed and emits message.failed, never message.sent', async () => {
    vi.mocked(prisma.message.findUnique).mockReset().mockResolvedValue({ lane: null } as any);
    const engine = { sendText: vi.fn().mockResolvedValue({ success: false, error: 'Client not ready' }) };
    const { svc, eventEmitter } = makeService(engine);
    const job = { messageDbId: 'm1', profileId: 'p1', to: '628123456789@s.whatsapp.net', type: 'text', content: { text: 'x' } };

    await expect(svc.deliverQueued(job, false)).resolves.toBeUndefined();

    expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'failed' } });
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, expect.objectContaining({ messageId: 'm1', error: 'Client not ready' }));
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(AppEvents.MESSAGE.SENT, expect.anything());
  });
});

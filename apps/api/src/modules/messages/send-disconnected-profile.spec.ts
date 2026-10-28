// A send through a profile with no live engine answers 409, not a false success.
//
// With ENGINE_HOST=api and DURABLE_SEND off, queueMessage used to find no engine,
// leave the row `pending` and answer 201 { success: true, status: 'pending' }.
// Nothing ever resends a `pending` row, so the caller was told its message was
// queued while it was lost — and every internal caller that trusts `success`
// (a scheduled send, a bulk batch) recorded a false "sent".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException, Logger } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), update: vi.fn() },
    scheduledMessage: { findMany: vi.fn(), update: vi.fn() },
  },
}));

// The lane classifier reads the database; its answer is irrelevant to this guard.
vi.mock('@multiwa/engine-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@multiwa/engine-runtime')>()),
  classifyColdSend: vi.fn().mockResolvedValue(false),
}));

// Keep @multiwa/engines -> baileys -> libsignal (an optional native dep) out of the import graph.
vi.mock('../profiles/engine-manager.service', () => ({
  EngineManagerService: class {},
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { MessagesService } from './messages.service';
import { ScheduledMessageCron } from './scheduled-message.cron';
import { BulkService } from '../bulk/bulk.service';
import { BulkMessageType } from '../bulk/dto';

const DTO = { profileId: 'p1', to: '628123456789', text: 'secret-body-text' };
const REASON = 'Profile is not connected; the message was not sent';

function makeService() {
  const engineManager = { getEngine: vi.fn().mockReturnValue(undefined) }; // profile disconnected
  const sendGate = { executeWithGate: vi.fn() };
  const eventEmitter = { emit: vi.fn() };
  const outboundQueue = { add: vi.fn() };
  const svc = new MessagesService(
    engineManager as any,
    sendGate as any,
    eventEmitter as any,
    outboundQueue as any,
    {} as any, // engineCommands
  );
  return { svc, engineManager, sendGate, eventEmitter, outboundQueue };
}

beforeEach(() => {
  vi.stubEnv('ENGINE_HOST', 'api');
  vi.stubEnv('DURABLE_SEND', 'false');
  vi.mocked(prisma.profile.findUnique).mockReset().mockResolvedValue({ id: 'p1' } as any);
  vi.mocked(prisma.conversation.findFirst).mockReset().mockResolvedValue({ id: 'c1' } as any);
  vi.mocked(prisma.conversation.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.message.create).mockReset().mockResolvedValue({ id: 'm1' } as any);
  vi.mocked(prisma.message.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.scheduledMessage.findMany).mockReset();
  vi.mocked(prisma.scheduledMessage.update).mockReset().mockResolvedValue({} as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('MessagesService: send through a disconnected profile (API-hosted synchronous path)', () => {
  it('rejects with 409 PROFILE_DISCONNECTED and never reaches the send gate', async () => {
    const { svc, sendGate } = makeService();

    const err = await svc.sendText(DTO as any).catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toEqual({ statusCode: 409, error: 'PROFILE_DISCONNECTED', message: REASON });
    expect(sendGate.executeWithGate).not.toHaveBeenCalled();
  });

  it('marks the message row failed (not left pending) and emits message.failed', async () => {
    const { svc, eventEmitter } = makeService();

    await svc.sendText(DTO as any).catch(() => undefined);

    expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'failed' } });
    expect(eventEmitter.emit).toHaveBeenCalledWith(AppEvents.MESSAGE.FAILED, {
      profileId: 'p1',
      messageId: 'm1',
      to: '628123456789@s.whatsapp.net',
      type: 'text',
      conversationId: 'c1',
      error: 'Profile not connected',
    });
  });

  it('logs one warn line that carries ids only, never the recipient or the body', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = makeService();

    await svc.sendText(DTO as any).catch(() => undefined);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('m1');
    expect(line).not.toContain('628123456789');
    expect(line).not.toContain('secret-body-text');
  });

  it('leaves the durable path alone: a disconnected profile is still enqueued, not rejected', async () => {
    vi.stubEnv('DURABLE_SEND', 'true');
    const { svc, engineManager, outboundQueue } = makeService();

    const res = await svc.sendText(DTO as any);

    expect(res).toMatchObject({ success: true, messageId: 'm1', status: 'queued' });
    expect(outboundQueue.add).toHaveBeenCalledTimes(1);
    expect(engineManager.getEngine).not.toHaveBeenCalled();
  });
});

// Internal callers that used to read the old 201 as "sent". The scheduled cron and bulk
// keep a sent-vs-failed verdict per message, so they are pinned here against the real
// MessagesService. The rule engine, broadcast and OTP catch the same throw (the broadcast
// failed-recipient path is covered in broadcast.service.spec.ts).
describe('internal callers record the failure instead of a false "sent"', () => {
  it('a scheduled message is marked failed with the reason, not sent', async () => {
    vi.mocked(prisma.scheduledMessage.findMany).mockResolvedValue([
      { id: 's1', profileId: 'p1', to: '628123456789', type: 'text', content: { text: 'hi' } },
    ] as any);
    const { svc } = makeService();

    await new ScheduledMessageCron(svc).processScheduledMessages();

    expect(prisma.scheduledMessage.update).toHaveBeenCalledTimes(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'failed', error: REASON },
    });
  });

  it('a bulk batch counts the message as failed, not sent', async () => {
    const { svc } = makeService();
    // The batch starts while the profile is up (bulk's own engine check passes) and the
    // profile drops before the send reaches MessagesService.
    const bulk = new BulkService({ getEngine: () => ({}) } as any, svc);

    const { batchId } = await bulk.sendBulk({
      profileId: 'p1',
      messages: [{ chatId: '628123456789', type: BulkMessageType.TEXT, content: { text: 'hi' } }],
    } as any);
    await vi.waitFor(async () => expect((await bulk.getBatchStatus(batchId, 'p1')).status).toBe('completed'));

    const batch = await bulk.getBatchStatus(batchId, 'p1');
    expect(batch.progress).toMatchObject({ sent: 0, failed: 1 });
    expect(batch.results?.[0]).toMatchObject({ status: 'failed', error: { message: REASON } });
  });
});

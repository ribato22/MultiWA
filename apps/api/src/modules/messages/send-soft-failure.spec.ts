// An engine failure that comes back as a RETURN VALUE is a failure for every caller.
//
// When the profile has an engine but its client is not ready (or WhatsApp rejects
// the recipient), the engine's send methods answer { success: false, error } and do
// not throw. MessagesService.queueMessage passes that on as the soft failure
// { success: false, status: 'failed', error } — it does not throw either. Callers
// that only expected a throw (the 409 from send-disconnected-profile.spec.ts) read
// the resolved call as "sent": a scheduled message was marked `sent` and an
// automation reply was logged as done, for a message that never went out.
//
// These specs run the real MessagesService against an engine that is not ready, so
// the shape the callers receive is the real one. The broadcast loop is covered in
// broadcast.service.spec.ts; bulk and OTP already read the soft failure correctly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    scheduledMessage: { findMany: vi.fn(), update: vi.fn() },
    automation: { findMany: vi.fn() },
    contact: { findFirst: vi.fn() },
  },
}));

// The lane classifier reads the database; its answer is irrelevant to these guards.
vi.mock('@multiwa/engine-runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@multiwa/engine-runtime')>()),
  classifyColdSend: vi.fn().mockResolvedValue(false),
}));

// Keep @multiwa/engines -> baileys -> libsignal (an optional native dep) out of the import graph.
vi.mock('../profiles/engine-manager.service', () => ({
  EngineManagerService: class {},
}));

import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';
import { ScheduledMessageCron } from './scheduled-message.cron';
import { RuleEngineService } from '../automation/rule-engine.service';

const REASON = 'Client not ready';

function makeService() {
  // The engine exists, but its client is not ready: it answers, it does not throw.
  const engine = { sendText: vi.fn().mockResolvedValue({ success: false, error: REASON }) };
  const engineManager = { getEngine: vi.fn().mockReturnValue(engine) };
  const sendGate = { executeWithGate: vi.fn((_profileId: string, send: () => Promise<unknown>) => send()) };
  const eventEmitter = { emit: vi.fn() };
  const svc = new MessagesService(
    engineManager as any,
    sendGate as any,
    eventEmitter as any,
    { add: vi.fn() } as any, // outboundQueue
    {} as any, // engineCommands
  );
  return svc;
}

beforeEach(() => {
  vi.stubEnv('ENGINE_HOST', 'api');
  vi.stubEnv('DURABLE_SEND', 'false');
  vi.mocked(prisma.profile.findUnique).mockReset().mockResolvedValue({ id: 'p1' } as any);
  vi.mocked(prisma.conversation.findFirst).mockReset().mockResolvedValue({ id: 'c1' } as any);
  vi.mocked(prisma.conversation.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.message.create).mockReset().mockResolvedValue({ id: 'm1' } as any);
  vi.mocked(prisma.message.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.message.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.scheduledMessage.findMany).mockReset();
  vi.mocked(prisma.scheduledMessage.update).mockReset().mockResolvedValue({} as any);
  vi.mocked(prisma.automation.findMany).mockReset();
  vi.mocked(prisma.contact.findFirst).mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a scheduled message whose send comes back { success: false }', () => {
  it('is marked failed with the engine reason, not sent', async () => {
    vi.mocked(prisma.scheduledMessage.findMany).mockResolvedValue([
      { id: 's1', profileId: 'p1', to: '628123456789', type: 'text', content: { text: 'hi' } },
    ] as any);

    await new ScheduledMessageCron(makeService()).processScheduledMessages();

    expect(prisma.scheduledMessage.update).toHaveBeenCalledTimes(1);
    expect(prisma.scheduledMessage.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'failed', error: REASON },
    });
  });
});

describe('an automation text reply whose send comes back { success: false }', () => {
  const INCOMING = {
    profileId: 'p1',
    conversationId: 'c1',
    senderJid: '628123456789@s.whatsapp.net',
    messageType: 'text',
    content: { text: 'hi' },
    timestamp: new Date(),
    isGroup: false,
    isNewContact: false,
  };

  function makeRuleEngine(action: object) {
    vi.mocked(prisma.automation.findMany).mockResolvedValue([
      { id: 'a1', triggerType: 'all', triggerConfig: {}, conditions: [], actions: [action] },
    ] as any);
    const automationService = {
      checkCooldown: vi.fn().mockResolvedValue(true),
      checkDailyLimit: vi.fn().mockResolvedValue(true),
      incrementTrigger: vi.fn().mockResolvedValue(undefined),
    };
    const aiService = {
      isConfigured: vi.fn().mockReturnValue(true),
      generateAutoReply: vi.fn().mockResolvedValue({ success: true, content: 'ai text' }),
    };
    return new RuleEngineService(automationService as any, makeService() as any, aiService as any, {} as any);
  }

  it('reply reports the failure, not success', async () => {
    const results = await makeRuleEngine({ type: 'reply', message: 'hello' }).processMessage(INCOMING);

    expect(results).toEqual([{ action: 'reply', success: false, error: REASON }]);
  });

  it('ai_reply reports the failure, not success', async () => {
    const results = await makeRuleEngine({ type: 'ai_reply' }).processMessage(INCOMING);

    expect(results).toEqual([{ action: 'ai_reply', success: false, error: REASON }]);
  });
});

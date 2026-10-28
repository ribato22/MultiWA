// WorkerRuleEngineService: an automation reply that was not sent is not reported as sent.
//
// WorkerMessagesService.sendText answers a failed send with { success: false,
// status: 'failed', error } instead of throwing. The `reply` and `ai_reply` actions
// ignored that answer and returned success: true, so the inbound handler logged
// "Action reply succeeded" for a reply that never went out. The media actions
// already check it. Mirrors the API rule engine (send-soft-failure.spec.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => {
  const prisma = {
    automation: { findMany: vi.fn() },
    contact: { findFirst: vi.fn() },
    message: { findMany: vi.fn() },
  };
  return { prisma, createPrismaClient: () => prisma };
});

// Keep @multiwa/engines -> baileys -> libsignal (an optional native dep) out of the import graph.
vi.mock('./engine-manager.service', () => ({ EngineManagerService: class {} }));

import { prisma } from '@multiwa/database';
import { WorkerRuleEngineService } from './rule-engine.service';

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

const NOT_SENT = { success: false, messageId: 'm1', conversationId: 'c1', status: 'failed', error: 'Client not ready' };

function makeEngine(sendText: unknown) {
  const automationService = {
    checkCooldown: vi.fn().mockResolvedValue(true),
    checkDailyLimit: vi.fn().mockResolvedValue(true),
    incrementTrigger: vi.fn().mockResolvedValue(undefined),
  };
  const messagesService = { sendText };
  const aiService = {
    isConfigured: vi.fn().mockReturnValue(true),
    generateAutoReply: vi.fn().mockResolvedValue({ success: true, content: 'ai text' }),
  };
  return new WorkerRuleEngineService(automationService as any, messagesService as any, aiService as any, {} as any);
}

function runWithAction(action: object) {
  vi.mocked(prisma.automation.findMany).mockResolvedValue([
    { id: 'a1', triggerType: 'all', triggerConfig: {}, conditions: [], actions: [action] },
  ] as any);
}

beforeEach(() => {
  vi.mocked(prisma.automation.findMany).mockReset();
  vi.mocked(prisma.contact.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.message.findMany).mockReset().mockResolvedValue([]);
});

describe('WorkerRuleEngineService: a text reply that was not sent', () => {
  it('reply reports the failure, not success', async () => {
    runWithAction({ type: 'reply', message: 'hello' });
    const engine = makeEngine(vi.fn().mockResolvedValue(NOT_SENT));

    const results = await engine.processMessage(INCOMING);

    expect(results).toEqual([{ action: 'reply', success: false, error: 'Client not ready' }]);
  });

  it('ai_reply reports the failure, not success', async () => {
    runWithAction({ type: 'ai_reply' });
    const engine = makeEngine(vi.fn().mockResolvedValue(NOT_SENT));

    const results = await engine.processMessage(INCOMING);

    expect(results).toEqual([{ action: 'ai_reply', success: false, error: 'Client not ready' }]);
  });
});

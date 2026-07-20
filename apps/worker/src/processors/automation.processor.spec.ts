// Unit spec for the worker AutomationProcessor — locks the trigger/condition/action
// branching: which incoming messages fire which automations, how conditions are
// evaluated (message_contains / message_matches / contact_has_tag), and that a
// non-matching message performs NO side effect (no reply, no tag write, no stats bump).
//
// The processor calls `const prisma = createPrismaClient()` at MODULE LOAD, so the
// @multiwa/database mock is hoisted and returns a stable client object; the test
// grabs that same object via createPrismaClient() to drive per-test return values.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => {
  const client = {
    contact: { findUnique: vi.fn(), update: vi.fn() },
    automation: { findMany: vi.fn(), update: vi.fn() },
    conversation: { findFirst: vi.fn(), create: vi.fn() },
    message: { create: vi.fn() },
  };
  // createPrismaClient() must return the SAME object each call so the module-load
  // instance and the test's handle are identical.
  return { createPrismaClient: () => client, prisma: client };
});

import { createPrismaClient } from '@multiwa/database';
import { AutomationProcessor, AutomationJob } from './automation.processor';

const prisma = createPrismaClient() as any;

// Minimal Job stand-in — the processor only reads `.data`.
const makeJob = (data: Partial<AutomationJob>): any => ({
  data: {
    profileId: 'p1',
    event: 'message.received',
    contactId: 'c1',
    messageBody: '',
    ...data,
  },
});

const contactFixture = (over: Partial<{ id: string; phone: string; tags: string[] }> = {}) => ({
  id: 'c1',
  phone: '628123456789',
  tags: [] as string[],
  ...over,
});

// Automation row factory with sensible defaults (active, wildcard trigger, no conditions).
const automationFixture = (over: Record<string, any> = {}) => ({
  id: 'a1',
  profileId: 'p1',
  isActive: true,
  priority: 0,
  triggerType: '*',
  conditions: null,
  actions: [],
  stats: {},
  ...over,
});

describe('AutomationProcessor.process', () => {
  let processor: AutomationProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new AutomationProcessor();

    // Safe defaults; individual tests override what they exercise.
    prisma.contact.findUnique.mockResolvedValue(contactFixture());
    prisma.contact.update.mockResolvedValue({});
    prisma.automation.findMany.mockResolvedValue([]);
    prisma.automation.update.mockResolvedValue({});
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: 'conv1' });
    prisma.message.create.mockResolvedValue({});
  });

  it('throws when the contact does not exist (and never queries automations)', async () => {
    prisma.contact.findUnique.mockResolvedValueOnce(null);

    await expect(processor.process(makeJob({ contactId: 'ghost' }))).rejects.toThrow('Contact not found');
    expect(prisma.automation.findMany).not.toHaveBeenCalled();
  });

  it('returns matched:0 and performs no action when there are no active automations', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([]);

    const result = await processor.process(makeJob({}));

    expect(result).toEqual({ matched: 0 });
    // The query filters to active automations for this profile.
    expect(prisma.automation.findMany).toHaveBeenCalledWith({
      where: { profileId: 'p1', isActive: true },
      orderBy: { priority: 'desc' },
    });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('skips an automation whose triggerType does not match the event (no result row, no side effect)', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({ triggerType: 'message.sent', actions: [{ type: 'send_message', value: 'hi' }] }),
    ]);

    const result = await processor.process(makeJob({ event: 'message.received' }));

    // A trigger mismatch `continue`s before pushing any result row.
    expect(result.matched).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it('fires a matching message_contains condition (case-insensitive) and sends the reply + bumps stats', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({
        triggerType: 'message.received',
        conditions: [{ type: 'message_contains', value: ['HELLO'] }],
        actions: [{ type: 'send_message', value: 'Hi there' }],
        stats: { trigger_count: 2 },
      }),
    ]);

    const result = await processor.process(makeJob({ messageBody: 'well hello world' }));

    expect(result.matched).toBe(1);
    // A conversation was created from the contact phone -> WhatsApp JID.
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { profileId: 'p1', contactId: 'c1', jid: '628123456789@s.whatsapp.net' },
    });
    // Outgoing reply message carries the action value as text.
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    const msgArg = prisma.message.create.mock.calls[0][0].data;
    expect(msgArg).toMatchObject({
      direction: 'outgoing',
      type: 'text',
      content: { text: 'Hi there' },
      conversationId: 'conv1',
    });
    // Stats incremented off the prior trigger_count (2 -> 3).
    expect(prisma.automation.update.mock.calls[0][0].data.stats.trigger_count).toBe(3);
  });

  it('performs NO action when a message_contains condition does not match', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({
        triggerType: 'message.received',
        conditions: [{ type: 'message_contains', value: ['refund'] }],
        actions: [{ type: 'send_message', value: 'Hi there' }],
      }),
    ]);

    const result = await processor.process(makeJob({ messageBody: 'where is my order' }));

    // Condition fail pushes a matched:false result row but runs no actions.
    expect(result.matched).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results![0].matched).toBe(false);
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.automation.update).not.toHaveBeenCalled();
  });

  it('evaluates a message_matches regex condition case-insensitively', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({
        conditions: [{ type: 'message_matches', value: '^order\\s+\\d+' }],
        actions: [{ type: 'send_message', value: 'Tracking your order' }],
      }),
    ]);

    // Uppercase input matches the lowercase-authored pattern via the 'i' flag.
    const result = await processor.process(makeJob({ messageBody: 'ORDER 42 please' }));

    expect(result.matched).toBe(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('requires ALL conditions to pass: contact_has_tag gates the action', async () => {
    prisma.automation.findMany.mockResolvedValue([
      automationFixture({
        conditions: [
          { type: 'message_contains', value: ['hello'] },
          { type: 'contact_has_tag', value: 'vip' },
        ],
        actions: [{ type: 'send_message', value: 'VIP hello' }],
      }),
    ]);

    // Contact WITHOUT the required tag -> no action.
    prisma.contact.findUnique.mockResolvedValueOnce(contactFixture({ tags: ['regular'] }));
    const miss = await processor.process(makeJob({ messageBody: 'hello there' }));
    expect(miss.matched).toBe(0);
    expect(prisma.message.create).not.toHaveBeenCalled();

    // Contact WITH the required tag -> action fires.
    prisma.contact.findUnique.mockResolvedValueOnce(contactFixture({ tags: ['vip'] }));
    const hit = await processor.process(makeJob({ messageBody: 'hello there' }));
    expect(hit.matched).toBe(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing conversation instead of creating a new one', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({ actions: [{ type: 'send_message', value: 'reuse' }] }),
    ]);
    prisma.conversation.findFirst.mockResolvedValueOnce({ id: 'existing-conv' });

    await processor.process(makeJob({ messageBody: 'anything' }));

    expect(prisma.conversation.create).not.toHaveBeenCalled();
    expect(prisma.message.create.mock.calls[0][0].data.conversationId).toBe('existing-conv');
  });

  it('applies add_tag and remove_tag actions to the contact (deduping added tags)', async () => {
    prisma.automation.findMany.mockResolvedValueOnce([
      automationFixture({
        actions: [
          { type: 'add_tag', value: 'lead' },
          { type: 'remove_tag', value: 'old' },
        ],
      }),
    ]);
    prisma.contact.findUnique.mockResolvedValueOnce(contactFixture({ tags: ['old', 'lead'] }));

    const result = await processor.process(makeJob({ messageBody: 'x' }));

    expect(result.matched).toBe(1);
    // add_tag dedupes against existing tags.
    expect(prisma.contact.update.mock.calls[0][0].data.tags).toEqual(['old', 'lead']);
    // remove_tag strips the named tag.
    expect(prisma.contact.update.mock.calls[1][0].data.tags).toEqual(['lead']);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

// Characterization suite for EngineManagerService.handleInboundMessage (the API,
// prod-active inbound path). This LOCKS the current behaviour before it is
// extracted into a shared @multiwa/engine-runtime helper: the same suite must
// stay green after the extraction (PR-B) proving the move changed nothing.
//
// Strategy: mock prisma + the engine; construct the service with stub collaborators;
// spy the private helpers it delegates to (resolveGroupName / emitEvent /
// notifyOrgUsers) so the assertions focus on handleInboundMessage's own
// orchestration (what it persists, emits, and skips).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
    contact: { findFirst: vi.fn(), create: vi.fn() },
    profile: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { EngineManagerService } from './engine-manager.service';

const PROFILE = '1eb28399-5fe1-40ed-bd0a-39a4b8ad4858';

function makeService() {
  const realtime = { emitMessage: vi.fn(), emitConnectionStatus: vi.fn(), emitMessageAck: vi.fn(), emitQR: vi.fn() };
  const ruleEngine = { processMessage: vi.fn().mockResolvedValue([]) };
  const notifications = { createForOrg: vi.fn() };
  const eventEmitter = { emit: vi.fn() };
  const service = new EngineManagerService(realtime as any, ruleEngine as any, notifications as any, eventEmitter as any);

  const engine = { resolveIdentity: vi.fn(), markAsRead: vi.fn(), getGroupInfo: vi.fn() };
  (service as any).engines = new Map([[PROFILE, { engine, profileId: PROFILE, status: 'connected' }]]);

  // Isolate handleInboundMessage from the helpers it delegates to.
  const resolveGroupName = vi.spyOn(service as any, 'resolveGroupName').mockResolvedValue('Group Subject');
  const emitEvent = vi.spyOn(service as any, 'emitEvent').mockImplementation(() => {});
  const notifyOrgUsers = vi.spyOn(service as any, 'notifyOrgUsers').mockResolvedValue(undefined);

  return { service, realtime, ruleEngine, engine, resolveGroupName, emitEvent, notifyOrgUsers };
}

function dm(overrides: Record<string, any> = {}): any {
  return { fromMe: false, type: 'chat', from: '628111017195@c.us', body: 'hello', timestamp: 1700000000, _data: {}, ...overrides };
}

const call = (svc: any, message: any) => (svc as any).handleInboundMessage(message, PROFILE);
const created = (m: any) => (m.mock.calls[0]?.[0] as any)?.data;

describe('EngineManagerService.handleInboundMessage (characterization)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.conversation.findFirst as any).mockResolvedValue(null);
    (prisma.conversation.create as any).mockImplementation(async ({ data }: any) => ({ id: 'conv-1', ...data }));
    (prisma.conversation.update as any).mockResolvedValue({});
    (prisma.message.create as any).mockImplementation(async ({ data }: any) => ({ id: 'msg-1', ...data }));
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    (prisma.contact.create as any).mockResolvedValue({});
    (prisma.profile.findUnique as any).mockResolvedValue({ id: PROFILE, dailyMessageLimit: null, dailyMessageCount: 0, dailyResetAt: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('1) skips own (fromMe) messages — nothing persisted', async () => {
    const { service } = makeService();
    await call(service, dm({ fromMe: true }));
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('2) skips WhatsApp system/protocol messages', async () => {
    const { service } = makeService();
    for (const t of ['e2e_notification', 'protocol', 'gp2', 'ciphertext', 'call_log', 'revoked']) {
      vi.clearAllMocks();
      await call(service, dm({ type: t }));
      expect(prisma.message.create).not.toHaveBeenCalled();
    }
  });

  it('3) DM from a new sender: creates a user conversation, persists the message, bumps unread, emits + notifies + creates the contact', async () => {
    const { service, realtime, emitEvent, notifyOrgUsers } = makeService();
    await call(service, dm());
    expect(created(prisma.conversation.create)).toMatchObject({ profileId: PROFILE, jid: '628111017195@s.whatsapp.net', type: 'user' });
    const msg = created(prisma.message.create);
    expect(msg).toMatchObject({ direction: 'incoming', type: 'text', status: 'received', conversationId: 'conv-1' });
    expect(msg.content).toEqual({ text: 'hello' });
    expect(msg.messageId).toBeTypeOf('string');
    const convUpd = (prisma.conversation.update as any).mock.calls[0][0].data;
    expect(convUpd.unreadCount).toEqual({ increment: 1 });
    expect(realtime.emitMessage).toHaveBeenCalledOnce();
    expect(emitEvent).toHaveBeenCalledWith('message.received', expect.objectContaining({ profileId: PROFILE }));
    expect(notifyOrgUsers).toHaveBeenCalledOnce();
    expect(prisma.contact.create).toHaveBeenCalledOnce();
  });

  it('4) DM @lid resolves to the real phone JID (dedups onto the phone conversation/contact)', async () => {
    const { service, engine } = makeService();
    engine.resolveIdentity.mockResolvedValue({ phoneJid: '628999@s.whatsapp.net', name: 'Real Name' });
    await call(service, dm({ from: '11223344@lid' }));
    expect(engine.resolveIdentity).toHaveBeenCalledWith('11223344@lid');
    // conversation looked up + created under the resolved phone JID, not the @lid
    expect((prisma.conversation.findFirst as any).mock.calls[0][0].where.jid).toBe('628999@s.whatsapp.net');
    expect(created(prisma.message.create).senderJid).toBe('628999@s.whatsapp.net');
    expect(created(prisma.conversation.create).name).toBe('Real Name');
  });

  it('5) group message uses the resolved group subject and does NOT create a contact', async () => {
    const { service, resolveGroupName } = makeService();
    await call(service, dm({ from: '120363@g.us', author: '628111017195@c.us' }));
    expect(resolveGroupName).toHaveBeenCalled();
    expect(created(prisma.conversation.create)).toMatchObject({ type: 'group', name: 'Group Subject' });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('6) group with an existing conversation backfills the authoritative subject', async () => {
    const { service } = makeService();
    (prisma.conversation.findFirst as any).mockResolvedValue({ id: 'conv-9', name: 'Old pushName', jid: '120363@g.us' });
    await call(service, dm({ from: '120363@g.us', author: '628111017195@c.us' }));
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conv-9' }, data: { name: 'Group Subject' } }));
  });

  it('7) media message downloads media and stores the body as caption', async () => {
    const { service } = makeService();
    const message = dm({ type: 'image', hasMedia: true, body: 'nice pic', downloadMedia: vi.fn().mockResolvedValue({ data: 'BASE64', mimetype: 'image/jpeg' }) });
    await call(service, message);
    expect(message.downloadMedia).toHaveBeenCalledOnce();
    const content = created(prisma.message.create).content;
    expect(content.caption).toBe('nice pic');
    expect(content.mimetype).toBe('image/jpeg');
  });

  it('8) location message extracts latitude/longitude into content', async () => {
    const { service } = makeService();
    await call(service, dm({ type: 'location', location: { latitude: -6.2, longitude: 106.8, description: 'Jakarta' } }));
    const content = created(prisma.message.create).content;
    expect(content.latitude).toBe(-6.2);
    expect(content.longitude).toBe(106.8);
  });

  it('9) AUTO_READ_ON_RECEIVE=true zeroes unread and marks the chat read on WhatsApp', async () => {
    vi.stubEnv('AUTO_READ_ON_RECEIVE', 'true');
    const { service, engine } = makeService();
    await call(service, dm());
    expect((prisma.conversation.update as any).mock.calls[0][0].data.unreadCount).toBe(0);
    expect(engine.markAsRead).toHaveBeenCalledWith('628111017195@s.whatsapp.net');
  });

  it('10) AUTO_READ off (default): increments unread, never marks read', async () => {
    const { service, engine } = makeService();
    await call(service, dm());
    expect((prisma.conversation.update as any).mock.calls[0][0].data.unreadCount).toEqual({ increment: 1 });
    expect(engine.markAsRead).not.toHaveBeenCalled();
  });

  it('11) normalizes the WhatsApp timestamp (seconds → ms, ms kept, invalid → now)', async () => {
    const { service } = makeService();
    await call(service, dm({ timestamp: 1700000000 }));
    expect(created(prisma.message.create).timestamp.getTime()).toBe(1700000000 * 1000);

    vi.clearAllMocks();
    (prisma.message.create as any).mockImplementation(async ({ data }: any) => ({ id: 'm', ...data }));
    await call(service, dm({ timestamp: 1700000000000 }));
    expect(created(prisma.message.create).timestamp.getTime()).toBe(1700000000000);

    vi.clearAllMocks();
    (prisma.message.create as any).mockImplementation(async ({ data }: any) => ({ id: 'm', ...data }));
    const before = Date.now();
    await call(service, dm({ timestamp: 0 }));
    expect(created(prisma.message.create).timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('12) existing contact: does not re-create the contact', async () => {
    const { service } = makeService();
    (prisma.contact.findFirst as any).mockResolvedValue({ id: 'contact-1' });
    await call(service, dm());
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('13) daily-cap reached (not yet reset): skips automation', async () => {
    const { service, ruleEngine } = makeService();
    (prisma.profile.findUnique as any).mockResolvedValue({ id: PROFILE, dailyMessageLimit: 10, dailyMessageCount: 10, dailyResetAt: new Date(Date.now() + 3600_000) });
    await call(service, dm());
    expect(ruleEngine.processMessage).not.toHaveBeenCalled();
  });

  it('14) under cap: runs automation with the built IncomingMessage', async () => {
    const { service, ruleEngine } = makeService();
    await call(service, dm());
    expect(ruleEngine.processMessage).toHaveBeenCalledOnce();
    expect(ruleEngine.processMessage.mock.calls[0][0]).toMatchObject({
      profileId: PROFILE, conversationId: 'conv-1', senderJid: '628111017195@s.whatsapp.net', isGroup: false, isNewContact: true, messageType: 'text',
    });
  });

  it('15) a persistence failure is caught and never throws out of the handler', async () => {
    const { service } = makeService();
    (prisma.message.create as any).mockRejectedValue(new Error('db down'));
    await expect(call(service, dm())).resolves.toBeUndefined();
  });
});

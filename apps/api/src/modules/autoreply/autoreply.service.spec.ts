// AutoreplyService.processWebhookReply unit tests — lock the SSRF-safe dynamic
// reply path: the URL is validated by assertWebhookUrlSafe BEFORE any fetch, the
// posted body is the message.received envelope, and every failure (guard reject,
// fetch reject, non-2xx, missing reply) is swallowed to null with no throw to the
// caller. Prisma, @multiwa/engine-runtime, and global fetch are mocked (no DB/net).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: {
    profile: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@multiwa/engine-runtime', () => ({
  assertWebhookUrlSafe: vi.fn(),
}));

import { prisma } from '@multiwa/database';
import { assertWebhookUrlSafe } from '@multiwa/engine-runtime';
import { AutoreplyService } from './autoreply.service';

describe('AutoreplyService.processWebhookReply', () => {
  let service: AutoreplyService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.mocked(prisma.profile.findUnique).mockReset();
    vi.mocked(assertWebhookUrlSafe).mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    service = new AutoreplyService();
  });

  it('returns null and skips the guard + fetch when the profile has no webhookUrl (disabled)', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValueOnce({ webhookUrl: null } as any);

    const result = await service.processWebhookReply('p1', { body: 'hi' });

    expect(result).toBeNull();
    expect(assertWebhookUrlSafe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs assertWebhookUrlSafe BEFORE fetch and posts the message.received envelope to the guarded URL', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ webhookUrl: 'https://hook.example/in' } as any);
    // Guard returns a DIFFERENT, sanitized URL; if fetch is called with it, the
    // guard provably ran first and its result was used (order + wiring in one shot).
    vi.mocked(assertWebhookUrlSafe).mockResolvedValue('https://hook.example/resolved' as any);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ reply: 'auto-answer' }) });

    const msg = { id: 'wa_1', from: '628@c.us', body: 'ping' };
    const result = await service.processWebhookReply('p1', msg);

    expect(assertWebhookUrlSafe).toHaveBeenCalledWith('https://hook.example/in');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook.example/resolved');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ event: 'message.received', profileId: 'p1', message: msg });
    expect(result).toBe('auto-answer');

    // Explicit call-order invariant: guard must precede the network call.
    expect(vi.mocked(assertWebhookUrlSafe).mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
  });

  it('when the guard rejects (SSRF blocked) it returns null and never reaches fetch', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ webhookUrl: 'http://169.254.169.254/latest' } as any);
    vi.mocked(assertWebhookUrlSafe).mockRejectedValue(new Error('blocked private ip'));

    const result = await service.processWebhookReply('p1', { body: 'x' });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a fetch rejection and resolves null (no throw to caller)', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ webhookUrl: 'https://hook.example/in' } as any);
    vi.mocked(assertWebhookUrlSafe).mockResolvedValue('https://hook.example/in' as any);
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.processWebhookReply('p1', { body: 'x' })).resolves.toBeNull();
  });

  it('returns null when the webhook responds non-2xx', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ webhookUrl: 'https://hook.example/in' } as any);
    vi.mocked(assertWebhookUrlSafe).mockResolvedValue('https://hook.example/in' as any);
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ reply: 'should-be-ignored' }) });

    expect(await service.processWebhookReply('p1', { body: 'x' })).toBeNull();
  });

  it('returns null when a 2xx body carries no reply field', async () => {
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ webhookUrl: 'https://hook.example/in' } as any);
    vi.mocked(assertWebhookUrlSafe).mockResolvedValue('https://hook.example/in' as any);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    expect(await service.processWebhookReply('p1', { body: 'x' })).toBeNull();
  });
});

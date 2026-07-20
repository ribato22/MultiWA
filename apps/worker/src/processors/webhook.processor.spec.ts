// Unit spec for the worker's WebhookProcessor. Locks three contracts:
//   1. X-MultiWA-Signature is a deterministic sha256 HMAC over the canonical
//      signed body (same body+secret => same hex sig) so SDK verifiers keep working.
//   2. The WebhookLog PII policy (policedLogPayload / WEBHOOK_LOG_PAYLOAD_MAX_BYTES):
//      0 => {}, -1 => full payload, N => message-body fields truncated with a
//      marker, default 512.
//   3. Delivery calls assertWebhookUrlSafe BEFORE fetch, sends the HMAC header, and
//      writes a WebhookLog row with the right statusCode on non-2xx / network failure.
//
// The processor calls `createPrismaClient()` at MODULE LOAD, so the database mock
// is hoisted and returns a single shared instance. No DB, no network, no Nest.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// One shared mock prisma instance: createPrismaClient() (called at module load by
// the SUT) and every later call return the SAME object, so the fns we assert on
// are the fns the processor actually invokes.
vi.mock('@multiwa/database', () => {
  const mockPrisma = {
    webhook: { findUnique: vi.fn() },
    webhookLog: { create: vi.fn() },
  };
  return {
    createPrismaClient: () => mockPrisma,
    prisma: mockPrisma,
  };
});

// assertWebhookUrlSafe is the SSRF guard; the pass-through returns the url so we
// can assert fetch is called with the validated target.
vi.mock('@multiwa/engine-runtime', () => ({
  assertWebhookUrlSafe: vi.fn(async (u: string) => u),
}));

import { createPrismaClient } from '@multiwa/database';
import { assertWebhookUrlSafe } from '@multiwa/engine-runtime';
import { WebhookProcessor } from './webhook.processor';

const mockPrisma = createPrismaClient() as unknown as {
  webhook: { findUnique: ReturnType<typeof vi.fn> };
  webhookLog: { create: ReturnType<typeof vi.fn> };
};

const fetchMock = vi.fn();

const ENV_KEY = 'WEBHOOK_LOG_PAYLOAD_MAX_BYTES';

function makeWebhook(overrides: Record<string, any> = {}) {
  return {
    id: 'wh-1',
    enabled: true,
    events: ['message.received'],
    profileId: 'profile-123',
    secret: 'top-secret',
    url: 'https://hook.example.com/in',
    headers: {},
    ...overrides,
  };
}

function makeResponse(overrides: Partial<{ ok: boolean; status: number; text: string }> = {}) {
  const { ok = true, status = 200, text = 'OK' } = overrides;
  return { ok, status, text: vi.fn(async () => text) };
}

function makeJob(dataOverrides: Record<string, any> = {}) {
  return {
    data: {
      webhookId: 'wh-1',
      event: 'message.received',
      payload: { id: 'm1', body: 'hello' },
      ...dataOverrides,
    },
  } as any;
}

describe('WebhookProcessor', () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.webhook.findUnique).mockReset();
    vi.mocked(mockPrisma.webhookLog.create).mockReset().mockResolvedValue({} as any);
    vi.mocked(assertWebhookUrlSafe).mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env[ENV_KEY];
  });

  // ---- 1. HMAC signature ------------------------------------------------------

  it('signs the canonical body with a deterministic sha256 HMAC (same body+secret => same sig)', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    await new WebhookProcessor().process(makeJob());

    const [, init] = fetchMock.mock.calls[0];
    const sentBody: string = init.body;
    const header: string = init.headers['X-MultiWA-Signature'];

    // Recompute independently over the EXACT body that was sent.
    const expected = crypto.createHmac('sha256', 'top-secret').update(sentBody).digest('hex');
    const expectedAgain = crypto.createHmac('sha256', 'top-secret').update(sentBody).digest('hex');

    expect(header).toBe(`sha256=${expected}`);
    expect(expected).toBe(expectedAgain); // deterministic
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/); // hex sha256
    // A different secret must NOT collide with the emitted signature.
    const other = crypto.createHmac('sha256', 'other-secret').update(sentBody).digest('hex');
    expect(header).not.toBe(`sha256=${other}`);
  });

  // ---- 2. WebhookLog PII policy (policedLogPayload) ---------------------------

  it('policy default (env unset) truncates body/text/caption/message to 512 + marker', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    const long = 'a'.repeat(600);
    await new WebhookProcessor().process(
      makeJob({ payload: { body: long, text: long, caption: long, message: long, id: 'keep' } }),
    );

    const logged = mockPrisma.webhookLog.create.mock.calls[0][0].data.payload;
    for (const key of ['body', 'text', 'caption', 'message']) {
      expect(logged[key]).toBe('a'.repeat(512) + '…[truncated]');
    }
    expect(logged.id).toBe('keep'); // non-message fields pass through untouched
  });

  it('policy 0 stores {} (PLN Batam PII-off posture)', async () => {
    process.env[ENV_KEY] = '0';
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    await new WebhookProcessor().process(makeJob({ payload: { body: 'secret text', id: 'm1' } }));

    expect(mockPrisma.webhookLog.create.mock.calls[0][0].data.payload).toEqual({});
  });

  it('policy -1 stores the full payload with no redaction', async () => {
    process.env[ENV_KEY] = '-1';
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    const payload = { body: 'x'.repeat(2000), id: 'm1' };
    await new WebhookProcessor().process(makeJob({ payload }));

    expect(mockPrisma.webhookLog.create.mock.calls[0][0].data.payload).toEqual(payload);
  });

  it('policy N truncates each message field to N chars + marker', async () => {
    process.env[ENV_KEY] = '10';
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    await new WebhookProcessor().process(
      makeJob({ payload: { body: 'b'.repeat(20), text: 'short' } }),
    );

    const logged = mockPrisma.webhookLog.create.mock.calls[0][0].data.payload;
    expect(logged.body).toBe('b'.repeat(10) + '…[truncated]');
    expect(logged.text).toBe('short'); // below N => left alone
  });

  // ---- 3. Delivery: SSRF guard + HMAC header + status logging -----------------

  it('calls assertWebhookUrlSafe BEFORE fetch, then fetches the safe url with the HMAC header', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse());

    await new WebhookProcessor().process(makeJob());

    expect(assertWebhookUrlSafe).toHaveBeenCalledWith('https://hook.example.com/in');
    // Order: the SSRF guard must run before the network request.
    const guardOrder = vi.mocked(assertWebhookUrlSafe).mock.invocationCallOrder[0];
    const fetchOrder = fetchMock.mock.invocationCallOrder[0];
    expect(guardOrder).toBeLessThan(fetchOrder);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook.example.com/in');
    expect(init.method).toBe('POST');
    expect(init.headers['X-MultiWA-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.headers['X-MultiWA-Event']).toBe('message.received');
    expect(init.redirect).toBe('error');
  });

  it('logs statusCode from a non-2xx response and then throws', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: 'boom' }));

    await expect(new WebhookProcessor().process(makeJob())).rejects.toThrow('Webhook returned 500');

    // First row is the delivery row carrying the real status code.
    const first = mockPrisma.webhookLog.create.mock.calls[0][0].data;
    expect(first.statusCode).toBe(500);
    expect(first.success).toBe(false);
    expect(first.response).toBe('boom');
  });

  it('logs a null statusCode + error message when fetch rejects, then rethrows', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook());
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(new WebhookProcessor().process(makeJob())).rejects.toThrow('ECONNREFUSED');

    const logged = mockPrisma.webhookLog.create.mock.calls[0][0].data;
    expect(logged.statusCode).toBeNull();
    expect(logged.success).toBe(false);
    expect(logged.response).toBe('ECONNREFUSED');
  });

  // ---- guards -----------------------------------------------------------------

  it('throws and never fetches when the webhook is disabled', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(makeWebhook({ enabled: false }));

    await expect(new WebhookProcessor().process(makeJob())).rejects.toThrow(
      'Webhook not found or disabled',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertWebhookUrlSafe).not.toHaveBeenCalled();
  });

  it('skips (no fetch, no log) when the event is not subscribed', async () => {
    mockPrisma.webhook.findUnique.mockResolvedValueOnce(
      makeWebhook({ events: ['message.sent'] }),
    );

    const result = await new WebhookProcessor().process(makeJob());

    expect(result).toEqual({ skipped: true, reason: 'Event not subscribed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrisma.webhookLog.create).not.toHaveBeenCalled();
  });
});

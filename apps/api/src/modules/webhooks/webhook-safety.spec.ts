// SSRF guard tests for assertWebhookUrlSafe (shared engine-runtime helper).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DNS so hostname cases are deterministic (no real network).
const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: any[]) => lookupMock(...args) }));

import { assertWebhookUrlSafe, WebhookUrlError } from '@multiwa/engine-runtime';

describe('assertWebhookUrlSafe', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  });

  it('allows a literal public IP', async () => {
    await expect(assertWebhookUrlSafe('https://8.8.8.8/hook')).resolves.toContain('8.8.8.8');
  });

  it.each([
    ['loopback', 'http://127.0.0.1/x'],
    ['private 10/8', 'http://10.0.0.5/x'],
    ['private 192.168', 'http://192.168.1.10/x'],
    ['link-local metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]/x'],
  ])('blocks a literal internal IP (%s)', async (_label, url) => {
    await expect(assertWebhookUrlSafe(url)).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it.each([
    ['file', 'file:///etc/passwd'],
    ['gopher', 'gopher://evil/x'],
    ['ftp', 'ftp://host/x'],
  ])('rejects a non-http(s) scheme (%s)', async (_label, url) => {
    await expect(assertWebhookUrlSafe(url)).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it('rejects a malformed URL', async () => {
    await expect(assertWebhookUrlSafe('not a url')).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it('allows a hostname that resolves to a public address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertWebhookUrlSafe('https://example.com/hook')).resolves.toBe(
      'https://example.com/hook',
    );
  });

  it('blocks a hostname that resolves to a private address (DNS-based SSRF)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    await expect(assertWebhookUrlSafe('https://sneaky.example/hook')).rejects.toBeInstanceOf(
      WebhookUrlError,
    );
  });

  it('blocks if ANY resolved address is internal', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(assertWebhookUrlSafe('https://mixed.example/hook')).rejects.toBeInstanceOf(
      WebhookUrlError,
    );
  });

  it('rejects when the hostname does not resolve', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertWebhookUrlSafe('https://nope.invalid/hook')).rejects.toBeInstanceOf(
      WebhookUrlError,
    );
  });

  describe('WEBHOOK_ALLOW_PRIVATE_TARGETS=true (self-hosted opt-in)', () => {
    beforeEach(() => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = 'true';
    });

    it('allows a literal private IP', async () => {
      await expect(assertWebhookUrlSafe('http://10.0.0.5/x')).resolves.toContain('10.0.0.5');
    });

    it('rewrites localhost to host.docker.internal', async () => {
      lookupMock.mockResolvedValue([{ address: '172.17.0.1', family: 4 }]);
      await expect(assertWebhookUrlSafe('http://localhost:5678/webhook')).resolves.toContain(
        'host.docker.internal',
      );
    });

    it('STILL blocks the cloud metadata endpoint', async () => {
      await expect(
        assertWebhookUrlSafe('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toBeInstanceOf(WebhookUrlError);
    });
  });
});

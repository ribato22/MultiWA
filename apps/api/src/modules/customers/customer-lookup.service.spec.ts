// CustomerLookupService with the HTTP call mocked: the settings and their defaults, the minute's cache (a found or not
// found answer kept, an unavailable one not), the refresh allowance per user, an admin's test, and log lines that carry
// the organization, the state, the status and the latency, never the secret or the answer.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Logger } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { organization: { findUnique: vi.fn() } } }));
vi.mock('./lookup', () => ({ fetchLookup: vi.fn() }));

import { prisma } from '@multiwa/database';
import { encrypt } from '../../common/crypto/secret-box';
import { fetchLookup } from './lookup';
import { CustomerLookupService, REFRESH_LIMIT, readCustomerConfig } from './customer-lookup.service';

const findOrg = prisma.organization.findUnique as unknown as Mock;
const call = fetchLookup as unknown as Mock;
const HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const T0 = new Date('2026-11-05T08:00:00.000Z').getTime();
const OK = { state: 'ok', status: 200, data: { name: 'Budi Santoso', fields: [], sections: [] }, latencyMs: 12 };
const NOT_FOUND = { state: 'not_found', status: 404, data: null, latencyMs: 9 };
const DOWN = { state: 'unavailable', status: 500, data: null, problem: 'status', latencyMs: 7 };

describe('readCustomerConfig', () => {
  it('answers the defaults for an organization that has none', () => {
    expect(readCustomerConfig({})).toEqual({ idLabel: 'Customer ID', lookupUrl: null, lookupSecretEnc: null, timeoutMs: 5000 });
    expect(readCustomerConfig(null)).toEqual(readCustomerConfig({}));
  });

  it('reads what PUT /customers/config stored', () => {
    const customers = { idLabel: 'ID Pelanggan', lookupUrl: 'https://crm.example.com/lookup', lookupSecretEnc: 'aa:bb:cc', timeoutMs: 3000 };
    expect(readCustomerConfig({ theme: 'dark', customers })).toEqual(customers);
  });

  it('keeps the timeout between 1 and 15 seconds, and ignores values of the wrong type', () => {
    expect(readCustomerConfig({ customers: { timeoutMs: 10 } }).timeoutMs).toBe(1000);
    expect(readCustomerConfig({ customers: { timeoutMs: 60_000 } }).timeoutMs).toBe(15000);
    expect(readCustomerConfig({ customers: { timeoutMs: 'soon', lookupUrl: 42, idLabel: '  ' } })).toEqual({
      idLabel: 'Customer ID', lookupUrl: null, lookupSecretEnc: null, timeoutMs: 5000,
    });
  });
});

describe('CustomerLookupService', () => {
  let service: CustomerLookupService;
  let secretEnc: string;
  const at = (ms: number) => vi.setSystemTime(T0 + ms);

  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    secretEnc = encrypt('tok-123');
    findOrg.mockReset().mockResolvedValue({ settings: { customers: { lookupUrl: 'https://crm.example.com/lookup', lookupSecretEnc: secretEnc, timeoutMs: 3000 } } });
    call.mockReset().mockResolvedValue(OK);
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new CustomerLookupService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is not_configured without a lookup URL, and calls nothing', async () => {
    findOrg.mockResolvedValue({ settings: {} });
    expect(await service.lookup('org-1', 'A-1', { userId: 'u1' })).toEqual({ state: 'not_configured', data: null, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false });
    expect(await service.test('org-1', 'A-1')).toEqual({ state: 'not_configured', data: null, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false, latencyMs: 0 });
    expect(call).not.toHaveBeenCalled();
  });

  it("calls the organization's URL with its secret decrypted and its timeout", async () => {
    expect(await service.lookup('org-1', 'A-1', { userId: 'u1' })).toEqual({ state: 'ok', data: OK.data, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false });
    expect(findOrg).toHaveBeenCalledWith({ where: { id: 'org-1' }, select: { settings: true } });
    expect(call).toHaveBeenCalledWith({ url: 'https://crm.example.com/lookup', secret: 'tok-123', timeoutMs: 3000 }, 'A-1');
  });

  it('sends no secret when none is set', async () => {
    findOrg.mockResolvedValue({ settings: { customers: { lookupUrl: 'https://crm.example.com/lookup' } } });
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    expect(call).toHaveBeenCalledWith({ url: 'https://crm.example.com/lookup', secret: null, timeoutMs: 5000 }, 'A-1');
  });

  it.each([['found', OK], ['not found', NOT_FOUND]] as const)('keeps a %s answer for a minute, per organization and ID', async (_what, outcome) => {
    call.mockResolvedValue(outcome);
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    at(59_000);
    expect(await service.lookup('org-1', 'A-1', { userId: 'u2' })).toEqual({ state: outcome.state, data: outcome.data, fetchedAt: '2026-11-05T08:00:00.000Z', cached: true });
    expect(call).toHaveBeenCalledTimes(1);
    await service.lookup('org-1', 'A-2', { userId: 'u1' });
    await service.lookup('org-2', 'A-1', { userId: 'u1' });
    expect(call).toHaveBeenCalledTimes(3);
    at(60_000);
    expect((await service.lookup('org-1', 'A-1', { userId: 'u1' })).cached).toBe(false);
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('keeps no unavailable answer', async () => {
    call.mockResolvedValue(DOWN);
    expect(await service.lookup('org-1', 'A-1', { userId: 'u1' })).toMatchObject({ state: 'unavailable', data: null, cached: false });
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it(`a refresh skips the cache ${REFRESH_LIMIT} times a minute per user; past that it is answered from the cache`, async () => {
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    for (let i = 0; i < REFRESH_LIMIT; i++) {
      expect((await service.lookup('org-1', 'A-1', { userId: 'u1', refresh: true })).cached).toBe(false);
    }
    expect(call).toHaveBeenCalledTimes(1 + REFRESH_LIMIT);
    at(59_000);
    expect(await service.lookup('org-1', 'A-1', { userId: 'u1', refresh: true })).toMatchObject({ state: 'ok', cached: true });
    expect(call).toHaveBeenCalledTimes(1 + REFRESH_LIMIT);
    // Another user has an allowance of their own; this refresh keeps a fresh answer until 119 s.
    expect((await service.lookup('org-1', 'A-1', { userId: 'u2', refresh: true })).cached).toBe(false);
    // A minute after its refreshes, u1 may refresh again: the answer kept at 59 s is skipped.
    at(61_000);
    expect((await service.lookup('org-1', 'A-1', { userId: 'u1', refresh: true })).cached).toBe(false);
  });

  it("an admin's test calls with the saved settings, neither reads nor fills the cache, and says how long it took", async () => {
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    expect(await service.test('org-1', 'A-1')).toEqual({ state: 'ok', data: OK.data, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false, latencyMs: 12 });
    expect(call).toHaveBeenCalledTimes(2);
    call.mockResolvedValue(NOT_FOUND);
    await service.test('org-1', 'A-2');
    expect((await service.lookup('org-1', 'A-2', { userId: 'u1' })).cached).toBe(false);
  });

  it("forget drops an organization's kept answers, and no other's", async () => {
    await service.lookup('org-1', 'A-1', { userId: 'u1' });
    await service.lookup('org-10', 'A-1', { userId: 'u1' });
    service.forget('org-1');
    expect((await service.lookup('org-1', 'A-1', { userId: 'u1' })).cached).toBe(false);
    expect((await service.lookup('org-10', 'A-1', { userId: 'u1' })).cached).toBe(true);
  });

  it('logs the organization, the state, the HTTP status and the latency; never the secret or the answer', async () => {
    call.mockResolvedValueOnce(OK).mockResolvedValueOnce(DOWN);
    await service.lookup('org-1\r\nforged', 'A-1', { userId: 'u1' });
    await service.lookup('org-1', 'A-2', { userId: 'u1' });
    const log = Logger.prototype.log as unknown as Mock;
    const warn = Logger.prototype.warn as unknown as Mock;
    expect(log).toHaveBeenCalledWith('Customer lookup org=org-1forged state=ok status=200 latencyMs=12');
    expect(warn).toHaveBeenCalledWith('Customer lookup org=org-1 state=unavailable status=500 latencyMs=7 problem=status');
    const written = JSON.stringify([log.mock.calls, warn.mock.calls]);
    for (const secret of ['tok-123', secretEnc, 'Budi']) expect(written).not.toContain(secret);
  });
});

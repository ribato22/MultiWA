// CustomersService with Prisma mocked: the customer ID and number rules, a link made once (and its race), a number's
// default ID, what a customer answers with, the edits a configured lookup refuses, the notes and their authors, the
// search, the history, the lookups, the settings and their secret, and every read and write scoped to the caller's
// organization (another organization's id is not found).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Every `prisma.<model>.<method>` is one vi.fn, made when a test first reads it.
const db = vi.hoisted(() => {
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const model = (name: string) =>
    new Proxy({}, {
      get: (_, fn) => {
        const key = `${name}.${String(fn)}`;
        if (!fns.has(key)) fns.set(key, vi.fn());
        return fns.get(key);
      },
    });
  return { fns, prisma: new Proxy({}, { get: (_, name) => model(String(name)) }) };
});
vi.mock('@multiwa/database', () => ({ prisma: db.prisma }));

import { CustomersService, toExternalId, toPhone, type Actor } from './customers.service';

const p = db.prisma as any;
const lookups = { config: vi.fn(), lookup: vi.fn(), test: vi.fn(), forget: vi.fn() };
const audit = { log: vi.fn() };
const service = () => new CustomersService(lookups as any, audit as any);

const MEMBER: Actor = { userId: 'u-member', organizationId: 'org-1', role: 'member', ip: '203.0.113.7', userAgent: 'test-agent' };
const ADMIN: Actor = { ...MEMBER, userId: 'u-admin', role: 'admin' };
const ELSEWHERE: Actor = { ...ADMIN, organizationId: 'org-2' };
const AT = new Date('2026-11-05T08:00:00.000Z');
const customerRow = (over: object = {}) => ({
  id: 'c-1', organizationId: 'org-1', externalId: '1234567890', displayName: null, manualFields: [], tags: [], lastLookupAt: null, createdAt: AT, updatedAt: AT, ...over,
});
const linkRow = (over: object = {}) => ({
  id: 'l-1', organizationId: 'org-1', customerId: 'c-1', phone: '6281100000001', linkedByUserId: 'u-member', linkedByApiKeyId: null, lastUsedAt: AT, createdAt: AT, ...over,
});
const noteRow = (over: object = {}) => ({
  id: 'n-1', customerId: 'c-1', authorUserId: 'u-member', authorApiKeyId: null, body: 'Prefers a call after 16:00', createdAt: AT, updatedAt: AT, ...over,
});
const clash = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
/** Found unless the query is scoped to another organization: a query without the scope would find another's row too. */
const inOrg1 = (where: any) => where?.organizationId === undefined || where.organizationId === 'org-1';
const calls = (name: string) => db.fns.get(name)?.mock.calls ?? [];

/** What findOne reads for the customer c-1 with these links and notes. The member is Mira, the key "CRM sync". */
function viewOf(links: object[], notes: object[] = []) {
  p.customer.findFirst.mockResolvedValue(customerRow());
  p.customerLink.findMany.mockResolvedValue(links);
  p.customerNote.findMany.mockResolvedValue(notes);
  p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
  p.apiKey.findMany.mockResolvedValue([{ id: 'k-1', name: 'CRM sync' }]);
}

beforeEach(() => {
  db.fns.forEach((fn) => fn.mockReset());
  for (const fn of [...Object.values(lookups), audit.log]) fn.mockReset();
  audit.log.mockResolvedValue(undefined);
  lookups.config.mockResolvedValue({ idLabel: 'Customer ID', lookupUrl: null, lookupSecretEnc: null, timeoutMs: 5000 });
});
afterEach(() => vi.useRealTimers());

describe('customer IDs and numbers', () => {
  it.each(['1234567890', 'AB-12.x_9', 'a', 'x'.repeat(64)])('takes the ID %j', (id) => {
    expect(toExternalId(id)).toBe(id);
  });

  it('trims the ID', () => {
    expect(toExternalId('  1234567890 ')).toBe('1234567890');
  });

  it.each(['', '   ', 'x'.repeat(65), '12 34', 'a/b', 'ü', 42, null, undefined, ['1234567890']])('refuses the ID %j', (id) => {
    expect(() => toExternalId(id)).toThrow(BadRequestException);
    expect(() => toExternalId(id)).toThrow('Invalid customer ID');
  });

  it.each([
    ['0811-0000-0001', '6281100000001'],
    ['+62 811 0000 0001', '6281100000001'],
    ['6281100000001@c.us', '6281100000001'],
  ])('links the number %j as %s', (input, phone) => {
    expect(toPhone(input)).toBe(phone);
  });

  it.each(['120363000000000001@g.us', '123456789012345@lid', '0811', 'Budi', 6281100000001])('refuses the number %j', (input) => {
    expect(() => toPhone(input)).toThrow(BadRequestException);
    expect(() => toPhone(input)).toThrow('Invalid phone number');
  });
});

describe('CustomersService.link', () => {
  it('makes the customer and the link when both are new, recorded by the user, and audits their ids only', async () => {
    p.customer.findUnique.mockResolvedValue(null);
    p.customer.create.mockResolvedValue(customerRow());
    p.customerLink.findUnique.mockResolvedValue(null);
    p.customerLink.create.mockResolvedValue(linkRow());
    viewOf([linkRow()]);

    const res = await service().link(MEMBER, ' 1234567890 ', '0811-0000-0001');

    expect(p.customer.findUnique).toHaveBeenCalledWith({ where: { organizationId_externalId: { organizationId: 'org-1', externalId: '1234567890' } } });
    expect(p.customer.create).toHaveBeenCalledWith({ data: { organizationId: 'org-1', externalId: '1234567890' } });
    expect(p.customerLink.findUnique).toHaveBeenCalledWith({ where: { customerId_phone: { customerId: 'c-1', phone: '6281100000001' } } });
    expect(p.customerLink.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', customerId: 'c-1', phone: '6281100000001', linkedByUserId: 'u-member', linkedByApiKeyId: null },
    });
    expect(res).toMatchObject({
      created: true,
      customer: { id: 'c-1', externalId: '1234567890' },
      link: { id: 'l-1', phone: '6281100000001', lastUsedAt: '2026-11-05T08:00:00.000Z', linkedBy: { type: 'user', id: 'u-member', name: 'Mira' } },
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      action: 'customer.link', userId: 'u-member', organizationId: 'org-1', resourceType: 'customer', resourceId: 'c-1',
      metadata: { customerId: 'c-1', linkId: 'l-1' }, ip: '203.0.113.7', userAgent: 'test-agent',
    });
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('6281100000001');
  });

  it("answers a link that exists without making one: it becomes the number's default, and nothing is audited", async () => {
    p.customer.findUnique.mockResolvedValue(customerRow());
    p.customerLink.findUnique.mockResolvedValue(linkRow());
    viewOf([linkRow()]);
    expect(await service().link(MEMBER, '1234567890', '6281100000001')).toMatchObject({ created: false, link: { id: 'l-1' } });
    for (const write of ['customer.create', 'customerLink.create']) expect(calls(write)).toEqual([]);
    expect(p.customerLink.update).toHaveBeenCalledWith({ where: { id: 'l-1' }, data: { lastUsedAt: expect.any(Date) } });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("a link made with an API key records the key and its user, and names the key", async () => {
    p.customer.findUnique.mockResolvedValue(customerRow());
    p.customerLink.findUnique.mockResolvedValue(null);
    p.customerLink.create.mockResolvedValue(linkRow({ linkedByApiKeyId: 'k-1' }));
    viewOf([linkRow({ linkedByApiKeyId: 'k-1' })]);
    const res = await service().link({ ...MEMBER, apiKeyId: 'k-1' }, '1234567890', '6281100000001');
    expect(p.customerLink.create).toHaveBeenCalledWith({ data: expect.objectContaining({ linkedByUserId: 'u-member', linkedByApiKeyId: 'k-1' }) });
    expect(p.apiKey.findMany).toHaveBeenCalledWith({ where: { id: { in: ['k-1'] }, user: { organizationId: 'org-1' } }, select: { id: true, name: true } });
    expect(res.link.linkedBy).toEqual({ type: 'apiKey', id: 'k-1', name: 'CRM sync' });
  });

  it('a create that loses a race to the same ID or number answers the row the other request made', async () => {
    p.customer.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(customerRow());
    p.customer.create.mockRejectedValue(clash());
    p.customerLink.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(linkRow());
    p.customerLink.create.mockRejectedValue(clash());
    viewOf([linkRow()]);
    await expect(service().link(MEMBER, '1234567890', '6281100000001')).resolves.toMatchObject({ created: false, customer: { id: 'c-1' }, link: { id: 'l-1' } });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('lets any other database error through', async () => {
    p.customer.findUnique.mockResolvedValue(null);
    p.customer.create.mockRejectedValue(new Error('connection lost'));
    await expect(service().link(MEMBER, '1234567890', '6281100000001')).rejects.toThrow('connection lost');
  });

  it('refuses a bad ID or number before it reads anything', async () => {
    await expect(service().link(MEMBER, 'not valid!', '6281100000001')).rejects.toThrow('Invalid customer ID');
    await expect(service().link(MEMBER, '1234567890', '120363000000000001@g.us')).rejects.toThrow('Invalid phone number');
    expect(calls('customer.findUnique')).toEqual([]);
  });
});

describe("a number's customers and its default ID", () => {
  it("byPhone: the organization's links of the normalized number, the one used last first", async () => {
    p.customerLink.findMany.mockResolvedValue([
      linkRow({ id: 'l-2', lastUsedAt: new Date('2026-11-05T09:00:00.000Z'), customer: { id: 'c-2', externalId: 'B-2', displayName: null } }),
      linkRow({ customer: { id: 'c-1', externalId: '1234567890', displayName: 'Budi Santoso' } }),
    ]);
    expect(await service().byPhone('org-1', '0811 0000 0001')).toEqual([
      { id: 'c-2', externalId: 'B-2', displayName: null, linkId: 'l-2', lastUsedAt: '2026-11-05T09:00:00.000Z' },
      { id: 'c-1', externalId: '1234567890', displayName: 'Budi Santoso', linkId: 'l-1', lastUsedAt: '2026-11-05T08:00:00.000Z' },
    ]);
    expect(p.customerLink.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', phone: '6281100000001' },
      orderBy: { lastUsedAt: 'desc' },
      include: { customer: { select: { id: true, externalId: true, displayName: true } } },
    });
    await expect(service().byPhone('org-1', '120363000000000001@g.us')).rejects.toThrow('Invalid phone number');
  });

  it("useLink makes the link its number's default, now", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
    p.customerLink.findFirst.mockResolvedValue(linkRow());
    p.customerLink.update.mockImplementation(async ({ data }: any) => linkRow(data));
    p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
    expect(await service().useLink(MEMBER, 'l-1')).toEqual({
      id: 'l-1', phone: '6281100000001', lastUsedAt: '2026-11-05T10:00:00.000Z', createdAt: '2026-11-05T08:00:00.000Z',
      linkedBy: { type: 'user', id: 'u-member', name: 'Mira' },
    });
    expect(p.customerLink.findFirst).toHaveBeenCalledWith({ where: { id: 'l-1', organizationId: 'org-1' } });
    expect(p.customerLink.update).toHaveBeenCalledWith({ where: { id: 'l-1' }, data: { lastUsedAt: new Date('2026-11-05T10:00:00.000Z') } });
  });

  it('unlink removes the link alone, and audits its ids', async () => {
    p.customerLink.findFirst.mockResolvedValue({ id: 'l-1', customerId: 'c-1' });
    p.customerLink.deleteMany.mockResolvedValue({ count: 1 });
    expect(await service().unlink(MEMBER, 'l-1')).toEqual({ success: true });
    expect(p.customerLink.deleteMany).toHaveBeenCalledWith({ where: { id: 'l-1' } });
    expect(calls('customer.deleteMany')).toEqual([]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.unlink', resourceId: 'c-1', metadata: { customerId: 'c-1', linkId: 'l-1' } }));
  });

  it('a link removed meanwhile is not found, and not audited', async () => {
    p.customerLink.findFirst.mockResolvedValue({ id: 'l-1', customerId: 'c-1' });
    p.customerLink.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service().unlink(MEMBER, 'l-1')).rejects.toThrow(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('CustomersService.findOne', () => {
  it('answers the customer with its links, tags, manual fields and 20 newest notes, and who made each', async () => {
    viewOf([linkRow({ id: 'l-2', linkedByApiKeyId: 'k-1' }), linkRow({ linkedByUserId: 'u-gone' })], [noteRow()]);
    p.customer.findFirst.mockResolvedValue(customerRow({
      displayName: 'Budi Santoso', tags: ['vip'], lastLookupAt: AT,
      manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }, { label: 7 }],
    }));
    expect(await service().findOne('org-1', 'c-1')).toEqual({
      id: 'c-1', externalId: '1234567890', displayName: 'Budi Santoso', tags: ['vip'],
      manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }],
      lastLookupAt: '2026-11-05T08:00:00.000Z', createdAt: '2026-11-05T08:00:00.000Z', updatedAt: '2026-11-05T08:00:00.000Z',
      links: [
        { id: 'l-2', phone: '6281100000001', lastUsedAt: '2026-11-05T08:00:00.000Z', createdAt: '2026-11-05T08:00:00.000Z', linkedBy: { type: 'apiKey', id: 'k-1', name: 'CRM sync' } },
        { id: 'l-1', phone: '6281100000001', lastUsedAt: '2026-11-05T08:00:00.000Z', createdAt: '2026-11-05T08:00:00.000Z', linkedBy: null },
      ],
      notes: [{
        id: 'n-1', body: 'Prefers a call after 16:00', createdAt: '2026-11-05T08:00:00.000Z', updatedAt: '2026-11-05T08:00:00.000Z',
        author: { type: 'user', id: 'u-member', name: 'Mira' },
      }],
    });
    expect(p.customer.findFirst).toHaveBeenCalledWith({ where: { id: 'c-1', organizationId: 'org-1' } });
    expect(p.customerLink.findMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' }, orderBy: { lastUsedAt: 'desc' } });
    expect(p.customerNote.findMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' }, orderBy: { createdAt: 'desc' }, take: 20 });
    expect(p.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-member', 'u-gone'] }, organizationId: 'org-1' }, select: { id: true, name: true } });
  });
});

describe('CustomersService.update and remove', () => {
  it('stores the tags trimmed, without blanks or repeats, and audits the change', async () => {
    viewOf([]);
    await service().update(MEMBER, 'c-1', { tags: [' vip ', 'vip', '', 'prepaid'] });
    expect(p.customer.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { tags: ['vip', 'prepaid'] } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.update', resourceId: 'c-1', metadata: { customerId: 'c-1' } }));
  });

  it('takes a name and fields typed by hand while no lookup is configured, and null clears the name', async () => {
    viewOf([]);
    await service().update(MEMBER, 'c-1', { displayName: '  Budi Santoso ', manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }] });
    expect(p.customer.update).toHaveBeenCalledWith({
      where: { id: 'c-1' }, data: { displayName: 'Budi Santoso', manualFields: [{ label: 'Tarif/Daya', value: 'R1 / 1300 VA' }] },
    });
    await service().update(MEMBER, 'c-1', { displayName: null });
    expect(p.customer.update).toHaveBeenLastCalledWith({ where: { id: 'c-1' }, data: { displayName: null } });
  });

  it('409 for a name or fields while a lookup is configured, and changes nothing; the tags still change', async () => {
    viewOf([]);
    lookups.config.mockResolvedValue({ idLabel: 'Customer ID', lookupUrl: 'https://crm.example.com/lookup', lookupSecretEnc: null, timeoutMs: 5000 });
    await expect(service().update(MEMBER, 'c-1', { displayName: 'Someone else' })).rejects.toThrow(ConflictException);
    await expect(service().update(MEMBER, 'c-1', { tags: ['vip'], manualFields: [] })).rejects.toThrow(ConflictException);
    expect(p.customer.update).not.toHaveBeenCalled();
    expect(lookups.config).toHaveBeenCalledWith('org-1');
    await service().update(MEMBER, 'c-1', { tags: ['vip'] });
    expect(p.customer.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { tags: ['vip'] } });
  });

  it("remove deletes the organization's customer (its links and notes go with it) and audits it", async () => {
    p.customer.deleteMany.mockResolvedValue({ count: 1 });
    expect(await service().remove(ADMIN, 'c-1')).toEqual({ success: true });
    expect(p.customer.deleteMany).toHaveBeenCalledWith({ where: { id: 'c-1', organizationId: 'org-1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.delete', userId: 'u-admin', resourceId: 'c-1', metadata: { customerId: 'c-1' } }));
  });
});

describe("another organization's ids", () => {
  it.each([
    ['findOne', (s: CustomersService) => s.findOne('org-2', 'c-1')],
    ['update', (s: CustomersService) => s.update(ELSEWHERE, 'c-1', { tags: ['vip'] })],
    ['remove', (s: CustomersService) => s.remove(ELSEWHERE, 'c-1')],
    ['useLink', (s: CustomersService) => s.useLink(ELSEWHERE, 'l-1')],
    ['unlink', (s: CustomersService) => s.unlink(ELSEWHERE, 'l-1')],
  ] as const)('%s: not found, and nothing changes', async (_name, act) => {
    p.customer.findFirst.mockImplementation(async ({ where }: any) => (inOrg1(where) ? customerRow() : null));
    p.customer.deleteMany.mockImplementation(async ({ where }: any) => ({ count: inOrg1(where) ? 1 : 0 }));
    p.customerLink.findFirst.mockImplementation(async ({ where }: any) => (inOrg1(where) ? linkRow() : null));
    p.customerLink.deleteMany.mockResolvedValue({ count: 1 });
    await expect(act(service())).rejects.toThrow(NotFoundException);
    for (const write of ['customer.update', 'customerLink.update', 'customerLink.deleteMany']) expect(calls(write)).toEqual([]);
    expect(audit.log).not.toHaveBeenCalled();
  });
});

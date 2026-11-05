// CustomersService with Prisma mocked: the customer ID and number rules, a link made once (and its race), a number's
// default ID, what a customer answers with, the edits a configured lookup refuses, the notes and their authors, the
// search, the history, the lookups, the settings and their secret, and every read and write scoped to the caller's
// organization (another organization's id is not found).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

// Every `prisma.<model>.<method>` is one vi.fn, made when a test first reads it; so are the client's own `prisma.$...`.
const db = vi.hoisted(() => {
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const fn = (key: string) => {
    if (!fns.has(key)) fns.set(key, vi.fn());
    return fns.get(key)!;
  };
  const model = (name: string) => new Proxy({}, { get: (_, method) => fn(`${name}.${String(method)}`) });
  return { fns, prisma: new Proxy({}, { get: (_, name) => (String(name).startsWith('$') ? fn(String(name)) : model(String(name))) }) };
});
vi.mock('@multiwa/database', () => ({ prisma: db.prisma }));

import { decrypt, encrypt } from '../../common/crypto/secret-box';
import { CustomersService, toExternalId, toPhone, type Actor } from './customers.service';

const p = db.prisma as any;
const lookups = { config: vi.fn(), lookup: vi.fn(), preview: vi.fn(), test: vi.fn(), forget: vi.fn() };
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
/** What Prisma raises for a write to a row a concurrent delete has taken: P2025 for a change, P2003 for a create that points at it. */
const vanished = (code: 'P2025' | 'P2003') => Object.assign(new Error(`Prisma ${code}`), { code });
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
  // A transaction's callback runs on the mocked client.
  p.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(p));
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

  it.each(['', '   '])('an empty or blank name (%j) clears the name, as null does', async (displayName) => {
    viewOf([]);
    await service().update(MEMBER, 'c-1', { displayName });
    expect(p.customer.update).toHaveBeenCalledWith({ where: { id: 'c-1' }, data: { displayName: null } });
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

describe('notes', () => {
  it('adds a note, trimmed, written by the caller and the key it came with, and audits its ids', async () => {
    p.customer.findFirst.mockResolvedValue(customerRow());
    p.customerNote.create.mockImplementation(async ({ data }: any) => noteRow({ id: 'n-2', ...data }));
    p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
    p.apiKey.findMany.mockResolvedValue([{ id: 'k-1', name: 'CRM sync' }]);
    const note = await service().addNote({ ...MEMBER, apiKeyId: 'k-1' }, 'c-1', '  Prefers a call after 16:00 ');
    expect(p.customerNote.create).toHaveBeenCalledWith({
      data: { customerId: 'c-1', body: 'Prefers a call after 16:00', authorUserId: 'u-member', authorApiKeyId: 'k-1' },
    });
    expect(note).toMatchObject({ id: 'n-2', body: 'Prefers a call after 16:00', author: { type: 'apiKey', id: 'k-1', name: 'CRM sync' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.note.create', resourceId: 'c-1', metadata: { customerId: 'c-1', noteId: 'n-2' } }));
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('Prefers a call');
  });

  it.each(['', '   ', 'x'.repeat(2001)])('refuses the note %j before it reads anything', async (body) => {
    await expect(service().addNote(MEMBER, 'c-1', body)).rejects.toThrow(BadRequestException);
    expect(calls('customer.findFirst')).toEqual([]);
    expect(calls('customerNote.create')).toEqual([]);
  });

  it("its author edits it; an owner or an admin edits anyone's; another member gets 403 and changes nothing", async () => {
    p.customerNote.findFirst.mockResolvedValue(noteRow());
    p.customerNote.update.mockImplementation(async ({ data }: any) => noteRow(data));
    p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
    await expect(service().editNote(MEMBER, 'c-1', 'n-1', 'Prefers a call after 17:00')).resolves.toMatchObject({ body: 'Prefers a call after 17:00' });
    await expect(service().editNote(ADMIN, 'c-1', 'n-1', 'Checked')).resolves.toMatchObject({ body: 'Checked' });
    await expect(service().editNote({ ...MEMBER, userId: 'u-owner', role: 'owner' }, 'c-1', 'n-1', 'Seen')).resolves.toMatchObject({ body: 'Seen' });
    expect(p.customerNote.findFirst).toHaveBeenCalledWith({ where: { id: 'n-1', customerId: 'c-1', customer: { organizationId: 'org-1' } } });
    p.customerNote.update.mockClear();
    const other = { ...MEMBER, userId: 'u-other' };
    await expect(service().editNote(other, 'c-1', 'n-1', 'Mine now')).rejects.toThrow(ForbiddenException);
    await expect(service().deleteNote(other, 'c-1', 'n-1')).rejects.toThrow(ForbiddenException);
    expect(p.customerNote.update).not.toHaveBeenCalled();
    expect(calls('customerNote.deleteMany')).toEqual([]);
  });

  it("a note written through one of its author's API keys is still the author's", async () => {
    p.customerNote.findFirst.mockResolvedValue(noteRow({ authorApiKeyId: 'k-1' }));
    p.customerNote.update.mockImplementation(async ({ data }: any) => noteRow({ authorApiKeyId: 'k-1', ...data }));
    p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
    p.apiKey.findMany.mockResolvedValue([{ id: 'k-1', name: 'CRM sync' }]);
    await expect(service().editNote(MEMBER, 'c-1', 'n-1', 'Edited in the dashboard')).resolves.toMatchObject({ body: 'Edited in the dashboard' });
  });

  it('deletes a note on the same terms, and audits its ids', async () => {
    p.customerNote.findFirst.mockResolvedValue(noteRow());
    p.customerNote.deleteMany.mockResolvedValue({ count: 1 });
    expect(await service().deleteNote(MEMBER, 'c-1', 'n-1')).toEqual({ success: true });
    expect(p.customerNote.deleteMany).toHaveBeenCalledWith({ where: { id: 'n-1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.note.delete', metadata: { customerId: 'c-1', noteId: 'n-1' } }));
  });

  it('a note deleted meanwhile is not found, and not audited', async () => {
    p.customerNote.findFirst.mockResolvedValue(noteRow());
    p.customerNote.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service().deleteNote(MEMBER, 'c-1', 'n-1')).rejects.toMatchObject({ status: 404, message: 'Note not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a note of another customer, or of another organization, is not found', async () => {
    p.customerNote.findFirst.mockImplementation(async ({ where }: any) =>
      (where.customerId !== undefined && where.customerId !== 'c-1') || !inOrg1(where.customer) ? null : noteRow());
    await expect(service().editNote(MEMBER, 'c-9', 'n-1', 'x')).rejects.toThrow(NotFoundException);
    await expect(service().editNote(ELSEWHERE, 'c-1', 'n-1', 'x')).rejects.toThrow(NotFoundException);
    await expect(service().deleteNote(ELSEWHERE, 'c-1', 'n-1')).rejects.toThrow(NotFoundException);
    expect(calls('customerNote.update')).toEqual([]);
    expect(calls('customerNote.deleteMany')).toEqual([]);
  });

  it('lists the notes newest first, a page at a time, at most 100', async () => {
    p.customer.findFirst.mockResolvedValue(customerRow());
    p.customerNote.findMany.mockResolvedValue([noteRow()]);
    p.customerNote.count.mockResolvedValue(41);
    p.user.findMany.mockResolvedValue([{ id: 'u-member', name: 'Mira' }]);
    expect(await service().notes('org-1', 'c-1', '3', '20')).toEqual({
      items: [expect.objectContaining({ id: 'n-1', author: { type: 'user', id: 'u-member', name: 'Mira' } })],
      total: 41,
    });
    expect(p.customerNote.findMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' }, orderBy: { createdAt: 'desc' }, skip: 40, take: 20 });
    await service().notes('org-1', 'c-1', undefined, '1000');
    expect(p.customerNote.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 100 }));
    await service().notes('org-1', 'c-1');
    expect(p.customerNote.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });
});

describe('a customer, link or note deleted between the read and the write answers 404', () => {
  it('link: the customer is gone when its link is made', async () => {
    p.customer.findUnique.mockResolvedValue(customerRow());
    p.customerLink.findUnique.mockResolvedValue(null);
    p.customerLink.create.mockRejectedValue(vanished('P2003'));
    await expect(service().link(MEMBER, '1234567890', '6281100000001')).rejects.toMatchObject({ status: 404, message: 'Customer not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("link: the link is gone when it becomes its number's default", async () => {
    p.customer.findUnique.mockResolvedValue(customerRow());
    p.customerLink.findUnique.mockResolvedValue(linkRow());
    p.customerLink.update.mockRejectedValue(vanished('P2025'));
    await expect(service().link(MEMBER, '1234567890', '6281100000001')).rejects.toMatchObject({ status: 404, message: 'Link not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("useLink: the link is gone when it is made its number's default", async () => {
    p.customerLink.findFirst.mockResolvedValue(linkRow());
    p.customerLink.update.mockRejectedValue(vanished('P2025'));
    await expect(service().useLink(MEMBER, 'l-1')).rejects.toMatchObject({ status: 404, message: 'Link not found' });
  });

  it('update: the customer is gone when its changes are saved, and nothing is audited', async () => {
    p.customer.findFirst.mockResolvedValue(customerRow());
    p.customer.update.mockRejectedValue(vanished('P2025'));
    await expect(service().update(MEMBER, 'c-1', { tags: ['vip'] })).rejects.toMatchObject({ status: 404, message: 'Customer not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('addNote: the customer is gone when the note is written, and nothing is audited', async () => {
    p.customer.findFirst.mockResolvedValue(customerRow());
    p.customerNote.create.mockRejectedValue(vanished('P2003'));
    await expect(service().addNote(MEMBER, 'c-1', 'hello')).rejects.toMatchObject({ status: 404, message: 'Customer not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('editNote: the note is gone when the edit is saved, and nothing is audited', async () => {
    p.customerNote.findFirst.mockResolvedValue(noteRow());
    p.customerNote.update.mockRejectedValue(vanished('P2025'));
    await expect(service().editNote(MEMBER, 'c-1', 'n-1', 'Edited')).rejects.toMatchObject({ status: 404, message: 'Note not found' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('any other database error is not a 404', async () => {
    p.customerLink.findFirst.mockResolvedValue(linkRow());
    p.customerLink.update.mockRejectedValue(new Error('connection lost'));
    await expect(service().useLink(MEMBER, 'l-1')).rejects.toThrow('connection lost');
    p.customerNote.findFirst.mockResolvedValue(noteRow());
    p.customerNote.update.mockRejectedValue(clash());
    await expect(service().editNote(MEMBER, 'c-1', 'n-1', 'Edited')).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('CustomersService.list', () => {
  beforeEach(() => {
    p.customer.findMany.mockResolvedValue([]);
    p.customer.count.mockResolvedValue(0);
  });

  it("searches the organization's customers by ID prefix, by name, and, for a number, by its digits", async () => {
    await service().list('org-1', { q: ' 0811-0000 ' });
    const where = {
      organizationId: 'org-1',
      OR: [
        { externalId: { startsWith: '0811-0000', mode: 'insensitive' } },
        { displayName: { contains: '0811-0000', mode: 'insensitive' } },
        { links: { some: { phone: { contains: '628110000' } } } },
      ],
    };
    expect(p.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(p.customer.count).toHaveBeenCalledWith({ where });
  });

  it('looks for no number in a query with a letter in it', async () => {
    await service().list('org-1', { q: 'AB-123' });
    expect(p.customer.findMany.mock.calls[0][0].where.OR).toEqual([
      { externalId: { startsWith: 'AB-123', mode: 'insensitive' } },
      { displayName: { contains: 'AB-123', mode: 'insensitive' } },
    ]);
  });

  it("searches for the text typed: a query's %, _ and \\ are no wildcards", async () => {
    await service().list('org-1', { q: '50%_a\\b' });
    expect(p.customer.findMany.mock.calls[0][0].where.OR).toEqual([
      { externalId: { startsWith: '50\\%\\_a\\\\b', mode: 'insensitive' } },
      { displayName: { contains: '50\\%\\_a\\\\b', mode: 'insensitive' } },
    ]);
  });

  it('lists every customer of the organization without a query, 25 a page by default and at most 100', async () => {
    await service().list('org-1', {});
    expect(p.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' }, orderBy: { updatedAt: 'desc' }, skip: 0, take: 25 }));
    await service().list('org-1', { page: '3', pageSize: '500' });
    expect(p.customer.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 200, take: 100 }));
  });

  it('answers each customer with its counts and its last activity: the newest link use or note', async () => {
    p.customer.findMany.mockResolvedValue([
      {
        ...customerRow({ displayName: 'Budi Santoso' }),
        links: [{ lastUsedAt: AT }, { lastUsedAt: new Date('2026-11-05T09:00:00.000Z') }],
        notes: [{ createdAt: new Date('2026-11-05T08:30:00.000Z') }],
        _count: { notes: 3 },
      },
      { ...customerRow({ id: 'c-2', externalId: 'B-2' }), links: [], notes: [], _count: { notes: 0 } },
    ]);
    p.customer.count.mockResolvedValue(2);
    expect(await service().list('org-1', { page: '1' })).toEqual({
      items: [
        { id: 'c-1', externalId: '1234567890', displayName: 'Budi Santoso', linkCount: 2, noteCount: 3, lastActivityAt: '2026-11-05T09:00:00.000Z' },
        { id: 'c-2', externalId: 'B-2', displayName: null, linkCount: 0, noteCount: 0, lastActivityAt: null },
      ],
      total: 2,
      page: 1,
      pageSize: 25,
    });
  });
});

describe('CustomersService.history', () => {
  const line = { displayName: 'Support line', phoneNumber: '6281100000099' };
  const jids = ['6281100000001@s.whatsapp.net', '6281100000001@c.us'];
  beforeEach(() => {
    p.customer.findFirst.mockResolvedValue(customerRow());
    p.customerLink.findMany.mockResolvedValue([{ phone: '6281100000001' }]);
    p.conversation.findMany.mockResolvedValue([
      { id: 'cv-1', profileId: 'p-1', jid: jids[0], lastMessageAt: new Date('2026-11-01T10:00:00.000Z'), updatedAt: AT, profile: line, _count: { messages: 12 } },
      { id: 'cv-2', profileId: 'p-2', jid: jids[1], lastMessageAt: null, updatedAt: new Date('2026-10-01T10:00:00.000Z'), profile: { displayName: null, phoneNumber: null }, _count: { messages: 1 } },
    ]);
    p.call.findMany.mockResolvedValue([
      { id: 'ca-1', profileId: 'p-1', fromJid: jids[0], startedAt: new Date('2026-11-02T09:00:00.000Z'), isVideo: false, outcome: 'answered_elsewhere', profile: line },
    ]);
  });

  it("reads the organization's one-to-one chats and calls of the linked numbers, under both JID forms", async () => {
    await service().history('org-1', 'c-1');
    expect(p.customerLink.findMany).toHaveBeenCalledWith({ where: { customerId: 'c-1' }, select: { phone: true } });
    const inOrg = { workspace: { organizationId: 'org-1' } };
    expect(p.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'user', jid: { in: jids }, profile: inOrg }, take: 20 }));
    expect(p.call.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isGroup: false, fromJid: { in: jids }, profile: inOrg }, take: 20 }));
  });

  it('answers them newest first, with what each was', async () => {
    expect(await service().history('org-1', 'c-1')).toEqual([
      { kind: 'call', id: 'ca-1', profileId: 'p-1', profileName: 'Support line', phone: '6281100000001', at: '2026-11-02T09:00:00.000Z', summary: 'Voice call, answered elsewhere' },
      { kind: 'conversation', id: 'cv-1', profileId: 'p-1', profileName: 'Support line', phone: '6281100000001', at: '2026-11-01T10:00:00.000Z', summary: '12 messages' },
      { kind: 'conversation', id: 'cv-2', profileId: 'p-2', profileName: '', phone: '6281100000001', at: '2026-10-01T10:00:00.000Z', summary: '1 message' },
    ]);
  });

  it('answers at most `limit` items (at most 50), and nothing for a customer without a number', async () => {
    expect(await service().history('org-1', 'c-1', '2')).toHaveLength(2);
    await service().history('org-1', 'c-1', '500');
    expect(p.call.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50 }));
    p.customerLink.findMany.mockResolvedValue([]);
    p.conversation.findMany.mockClear();
    expect(await service().history('org-1', 'c-1')).toEqual([]);
    expect(p.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe('lookups', () => {
  const ok = (fetchedAt: string, cached = false) => ({ state: 'ok', data: { name: 'Budi Santoso', fields: [], sections: [] }, fetchedAt, cached });

  it("a customer's lookup keeps the name and the time of an answer newer than the stored one", async () => {
    p.customer.findFirst.mockResolvedValue(customerRow({ lastLookupAt: new Date('2026-11-05T07:00:00.000Z') }));
    lookups.lookup.mockResolvedValue(ok('2026-11-05T08:00:00.000Z', true));
    expect(await service().lookup(MEMBER, 'c-1', true)).toEqual(ok('2026-11-05T08:00:00.000Z', true));
    expect(lookups.lookup).toHaveBeenCalledWith('org-1', '1234567890', { userId: 'u-member', refresh: true });
    expect(p.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c-1' }, data: { lastLookupAt: new Date('2026-11-05T08:00:00.000Z'), displayName: 'Budi Santoso' },
    });
  });

  it('stores nothing for an answer stored already, or one that is not ok', async () => {
    p.customer.findFirst.mockResolvedValue(customerRow({ lastLookupAt: new Date('2026-11-05T08:00:00.000Z') }));
    lookups.lookup.mockResolvedValue(ok('2026-11-05T08:00:00.000Z', true));
    await service().lookup(MEMBER, 'c-1', false);
    lookups.lookup.mockResolvedValue({ state: 'not_found', data: null, fetchedAt: '2026-11-05T09:00:00.000Z', cached: false });
    await service().lookup(MEMBER, 'c-1', false);
    expect(calls('customer.updateMany')).toEqual([]);
  });

  it('a preview checks the ID, hands the caller with its API key to the lookup, and stores nothing', async () => {
    const answer = { state: 'not_found', data: null, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false };
    lookups.preview.mockResolvedValue(answer);
    const key: Actor = { ...MEMBER, apiKeyId: 'k-1' };
    expect(await service().preview(key, ' A-1 ')).toEqual(answer);
    expect(lookups.preview).toHaveBeenCalledWith('org-1', 'A-1', key);
    await expect(service().preview(MEMBER, 'a b')).rejects.toThrow('Invalid customer ID');
    expect(lookups.preview).toHaveBeenCalledTimes(1); // an ID that breaks the rule is not asked, nor counted
    expect(lookups.lookup).not.toHaveBeenCalled();
    for (const write of ['customer.create', 'customer.update', 'customer.updateMany']) expect(calls(write)).toEqual([]);
  });
});

describe("another organization's customer, for the notes, the history and the lookup", () => {
  it.each([
    ['notes', (s: CustomersService) => s.notes('org-2', 'c-1')],
    ['addNote', (s: CustomersService) => s.addNote(ELSEWHERE, 'c-1', 'hello')],
    ['history', (s: CustomersService) => s.history('org-2', 'c-1')],
    ['lookup', (s: CustomersService) => s.lookup(ELSEWHERE, 'c-1', false)],
  ] as const)('%s: not found', async (_name, act) => {
    p.customer.findFirst.mockImplementation(async ({ where }: any) => (inOrg1(where) ? customerRow() : null));
    await expect(act(service())).rejects.toThrow(NotFoundException);
    for (const read of ['customerNote.findMany', 'customerNote.create', 'customerLink.findMany']) expect(calls(read)).toEqual([]);
    expect(lookups.lookup).not.toHaveBeenCalled();
  });
});

describe('the lookup settings', () => {
  const HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const saved = (n = 0) => p.organization.update.mock.calls[n][0];
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', HEX_KEY);
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE_TARGETS', 'false');
    p.organization.findUnique.mockResolvedValue({ settings: { theme: 'dark' } });
    p.organization.update.mockResolvedValue({});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('GET answers whether a secret is set, never the secret', async () => {
    lookups.config.mockResolvedValue({ idLabel: 'Customer ID', lookupUrl: null, lookupSecretEnc: 'aa:bb:cc', timeoutMs: 5000 });
    expect(await service().getConfig('org-1')).toEqual({ idLabel: 'Customer ID', lookupUrl: null, hasSecret: true, timeoutMs: 5000, configured: false });
    expect(lookups.config).toHaveBeenCalledWith('org-1');
  });

  it('PUT saves a URL the SSRF rule takes and the secret encrypted, keeps the other settings, and forgets the kept answers', async () => {
    const view = await service().setConfig(ADMIN, { idLabel: ' ID Pelanggan ', lookupUrl: ' https://8.8.8.8/lookup ', secret: 'tok-123', timeoutMs: 3000 });
    expect(p.organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org-1' }, select: { settings: true } });
    expect(saved().where).toEqual({ id: 'org-1' });
    expect(saved().data.settings.theme).toBe('dark');
    const stored = saved().data.settings.customers;
    expect(stored).toMatchObject({ idLabel: 'ID Pelanggan', lookupUrl: 'https://8.8.8.8/lookup', timeoutMs: 3000 });
    expect(stored.lookupSecretEnc).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decrypt(stored.lookupSecretEnc)).toBe('tok-123');
    expect(view).toEqual({ idLabel: 'ID Pelanggan', lookupUrl: 'https://8.8.8.8/lookup', hasSecret: true, timeoutMs: 3000, configured: true });
    expect(JSON.stringify(view)).not.toContain('tok-123');
    expect(JSON.stringify(view)).not.toContain(stored.lookupSecretEnc);
    expect(lookups.forget).toHaveBeenCalledWith('org-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'customer.config.update', organizationId: 'org-1', userId: 'u-admin', metadata: {} }));
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('tok-123');
  });

  it('PUT locks the organization row, then reads, merges and writes inside the one transaction', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'org-1' }]),
      organization: { findUnique: vi.fn().mockResolvedValue({ settings: { theme: 'dark' } }), update: vi.fn().mockResolvedValue({}) },
    };
    p.$transaction.mockImplementation((run: (client: unknown) => unknown) => run(tx));
    await service().setConfig(ADMIN, { timeoutMs: 8000 });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = tx.$queryRaw.mock.calls[0];
    expect([sql.join('?'), values]).toEqual(['SELECT id FROM organizations WHERE id = ? FOR UPDATE', ['org-1']]);
    const at = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
    expect(at(tx.$queryRaw)).toBeLessThan(at(tx.organization.findUnique));
    expect(at(tx.organization.findUnique)).toBeLessThan(at(tx.organization.update));
    expect(tx.organization.update.mock.calls[0][0].data.settings).toEqual({
      theme: 'dark', customers: { idLabel: 'Customer ID', lookupUrl: null, lookupSecretEnc: null, timeoutMs: 8000 },
    });
    // Nothing read or wrote the row outside the transaction: a read there would not wait for the lock.
    for (const outside of ['organization.findUnique', 'organization.update']) expect(calls(outside)).toEqual([]);
  });

  it("PUT answers 400 with the rule's message for a URL the SSRF rule refuses, and saves nothing", async () => {
    await expect(service().setConfig(ADMIN, { lookupUrl: 'http://127.0.0.1:8080/lookup' })).rejects.toThrow(BadRequestException);
    await expect(service().setConfig(ADMIN, { lookupUrl: 'http://127.0.0.1:8080/lookup' })).rejects.toThrow('Webhook target address is not allowed');
    await expect(service().setConfig(ADMIN, { lookupUrl: 'ftp://8.8.8.8/lookup' })).rejects.toThrow('Unsupported webhook URL scheme "ftp:"');
    expect(p.organization.update).not.toHaveBeenCalled();
    expect(lookups.forget).not.toHaveBeenCalled();
    // The URL check resolves a host: it runs before the lock is taken, which is not held for it.
    expect(calls('$transaction')).toEqual([]);
  });

  it('PUT keeps an omitted secret and clears an empty one; an empty URL turns the lookup off', async () => {
    const enc = encrypt('tok-123');
    p.organization.findUnique.mockResolvedValue({ settings: { customers: { lookupUrl: 'https://8.8.8.8/lookup', lookupSecretEnc: enc, timeoutMs: 5000 } } });
    await service().setConfig(ADMIN, { timeoutMs: 8000 });
    expect(saved(0).data.settings.customers).toEqual({ idLabel: 'Customer ID', lookupUrl: 'https://8.8.8.8/lookup', lookupSecretEnc: enc, timeoutMs: 8000 });
    expect(await service().setConfig(ADMIN, { secret: '', lookupUrl: '' })).toMatchObject({ hasSecret: false, configured: false, lookupUrl: null });
    expect(saved(1).data.settings.customers).toMatchObject({ lookupUrl: null, lookupSecretEnc: null });
  });

  it('PUT refuses an ID label that is blank once trimmed', async () => {
    await expect(service().setConfig(ADMIN, { idLabel: '   ' })).rejects.toThrow(BadRequestException);
    expect(p.organization.update).not.toHaveBeenCalled();
    expect(calls('$transaction')).toEqual([]);
  });

  it('a test runs one lookup of a valid ID with the saved settings', async () => {
    lookups.test.mockResolvedValue({ state: 'ok', data: null, fetchedAt: '2026-11-05T08:00:00.000Z', cached: false, latencyMs: 3 });
    expect(await service().testConfig('org-1', ' A-1 ')).toMatchObject({ state: 'ok', latencyMs: 3 });
    expect(lookups.test).toHaveBeenCalledWith('org-1', 'A-1');
    await expect(service().testConfig('org-1', 'a b')).rejects.toThrow('Invalid customer ID');
  });
});

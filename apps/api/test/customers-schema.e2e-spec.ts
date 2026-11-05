// The customer tables in Postgres, as CustomersService relies on them: an ID once per organization, a number once per
// customer (and on several customers), and the deletion of a customer or an organization taking what hangs on it.
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@multiwa/database';

const tag = `cs${Date.now()}`;

describe('Customer tables (e2e)', () => {
  const made: string[] = [];
  const organization = async (name: string) => {
    const org = await prisma.organization.create({ data: { name: `${tag} ${name}`, slug: `${tag}-${name}` } });
    made.push(org.id);
    return org.id;
  };

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: made } } });
  });

  it('holds an ID once per organization, and the same ID in another organization', async () => {
    const [a, b] = [await organization('a'), await organization('b')];
    await prisma.customer.create({ data: { organizationId: a, externalId: '1234567890' } });
    await expect(prisma.customer.create({ data: { organizationId: a, externalId: '1234567890' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.customer.create({ data: { organizationId: b, externalId: '1234567890' } })).resolves.toMatchObject({
      externalId: '1234567890', displayName: null, manualFields: [], tags: [], lastLookupAt: null,
    });
  });

  it('links a number once per customer, and to several customers', async () => {
    const org = await organization('c');
    const first = await prisma.customer.create({ data: { organizationId: org, externalId: 'A-1' } });
    const second = await prisma.customer.create({ data: { organizationId: org, externalId: 'A-2' } });
    await prisma.customerLink.create({ data: { organizationId: org, customerId: first.id, phone: '6281100000001' } });
    await expect(prisma.customerLink.create({ data: { organizationId: org, customerId: first.id, phone: '6281100000001' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.customerLink.create({ data: { organizationId: org, customerId: second.id, phone: '6281100000001' } })).resolves.toMatchObject({
      phone: '6281100000001', linkedByUserId: null, linkedByApiKeyId: null,
    });
  });

  it("deletes a customer's links and notes with it, and an organization's customers with it", async () => {
    const org = await organization('d');
    const kept = await prisma.customer.create({ data: { organizationId: org, externalId: 'D-1' } });
    const gone = await prisma.customer.create({ data: { organizationId: org, externalId: 'D-2' } });
    for (const c of [kept, gone]) {
      await prisma.customerLink.create({ data: { organizationId: org, customerId: c.id, phone: '6281100000002' } });
      await prisma.customerNote.create({ data: { customerId: c.id, body: 'Prefers a call after 16:00' } });
    }
    await prisma.customer.delete({ where: { id: gone.id } });
    expect(await prisma.customerLink.count({ where: { customerId: gone.id } })).toBe(0);
    expect(await prisma.customerNote.count({ where: { customerId: gone.id } })).toBe(0);
    expect(await prisma.customerLink.count({ where: { customerId: kept.id } })).toBe(1);

    await prisma.organization.delete({ where: { id: org } });
    expect(await prisma.customer.count({ where: { organizationId: org } })).toBe(0);
    expect(await prisma.customerLink.count({ where: { customerId: kept.id } })).toBe(0);
    expect(await prisma.customerNote.count({ where: { customerId: kept.id } })).toBe(0);
  });
});

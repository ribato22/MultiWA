// The customers of the fake backend, for the customer panel, the Customers pages and Settings → Customers. Made-up
// data only: the repo is public.
import type { Page } from '@playwright/test';
import { expect, get, on, PROFILE, type FakeBackend, type Reply, type Req } from './fixtures';

export const PHONE = '6281100000001';
const AT = '2026-11-01T03:00:00.000Z';
export const NOW = '2026-11-04T03:00:00.000Z';

/** A one-to-one chat with `PHONE`, named after its contact. */
export const CONV = { id: 'conv-1', profileId: PROFILE.id, jid: `${PHONE}@s.whatsapp.net`, contactId: 'ct-1', name: 'Pak Budi', type: 'user', unreadCount: 0, lastMessageAt: AT };
export const CONTACT = { id: 'ct-1', profileId: PROFILE.id, phone: PHONE, name: 'Pak Budi', tags: ['vip'], createdAt: AT };

/** The organization's customer settings: a lookup endpoint with a secret, and its own name for a customer's ID. */
export const CONFIG = { idLabel: 'ID Pelanggan', lookupUrl: 'https://crm.example.com/lookup', hasSecret: true, timeoutMs: 5000, configured: true };
/** No lookup endpoint: agents type a customer's details by hand. */
export const MANUAL = { ...CONFIG, lookupUrl: null, hasSecret: false, configured: false };

/** The signed-in user (`ME`) as an author, and a teammate. */
export const ADA = { type: 'user', id: 'u-ada', name: 'Ada Agent' };
export const MIA = { type: 'user', id: 'u-mia', name: 'Mia Member' };

/** `PHONE`'s default customer: a tag, and two notes, the newer by Mia and the older by the signed-in user. */
export const CUSTOMER = {
  id: 'cus-1', externalId: '1234567890', displayName: 'Budi Santoso', tags: ['priority'],
  manualFields: [] as Array<{ label: string; value: string }>,
  lastLookupAt: AT, createdAt: AT, updatedAt: AT,
  links: [{ id: 'lnk-1', phone: PHONE, lastUsedAt: '2026-11-03T03:00:00.000Z', createdAt: AT, linkedBy: MIA }],
  notes: [
    { id: 'note-2', body: 'Asked about the October bill', createdAt: '2026-11-02T03:00:00.000Z', updatedAt: '2026-11-02T03:00:00.000Z', author: MIA },
    { id: 'note-1', body: 'Prefers WhatsApp to calls', createdAt: AT, updatedAt: AT, author: ADA },
  ],
};
/** `PHONE`'s other customer. */
export const SECOND = {
  ...CUSTOMER, id: 'cus-2', externalId: '9876543210', displayName: 'Siti Rahayu', tags: [] as string[], notes: [] as typeof CUSTOMER.notes,
  links: [{ id: 'lnk-2', phone: PHONE, lastUsedAt: AT, createdAt: AT, linkedBy: MIA }],
};
/** `GET /customers/by-phone/PHONE`: the default first. */
export const BY_PHONE = [
  { id: CUSTOMER.id, externalId: CUSTOMER.externalId, displayName: CUSTOMER.displayName, linkId: 'lnk-1', lastUsedAt: '2026-11-03T03:00:00.000Z' },
  { id: SECOND.id, externalId: SECOND.externalId, displayName: SECOND.displayName, linkId: 'lnk-2', lastUsedAt: AT },
];

export const lookupAnswer = (state: string, data: unknown = null) => ({ state, data, fetchedAt: NOW, cached: false });
/** What the organization's system says of `CUSTOMER`. */
export const LOOKUP_DATA = {
  id: '1234567890',
  name: 'Budi Santoso',
  fields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }, { label: 'Tarif/Daya', value: 'R1 / 1300 VA' }],
  sections: [{ title: 'Tagihan', rows: [{ label: 'Okt 2026', value: 'Rp 245.000 (lunas)' }] }],
};
export const LOOKUP_OK = lookupAnswer('ok', LOOKUP_DATA);

type Answer = Reply | ((req: Req) => Reply | Promise<Reply>);
/** A record of the fake backend: its id, and whatever else a test gives it. */
type Row = { id: string } & Record<string, unknown>;

/**
 * What the panel and a customer's page read: the settings, `PHONE`'s customers, each customer, its lookup (`LOOKUP_OK`,
 * and Siti Rahayu's name for `SECOND`) and `PHONE`'s contact. A test's own routes, added after, win.
 */
export function customerBackend(
  backend: FakeBackend,
  opts: { config?: unknown; byPhone?: unknown[]; customers?: Row[]; lookup?: Answer } = {},
) {
  const customers = opts.customers ?? [CUSTOMER, SECOND];
  const siti = lookupAnswer('ok', { name: 'Siti Rahayu', fields: [], sections: [] });
  backend.route(get('/customers/config', opts.config ?? CONFIG));
  backend.route(get(`/customers/by-phone/${PHONE}`, opts.byPhone ?? BY_PHONE));
  backend.route(get('/contacts', { contacts: [CONTACT], total: 1, limit: 5, offset: 0 }));
  backend.route((r) => {
    const found = r.method === 'GET' ? customers.find((c) => r.path === `/customers/${c.id}`) : undefined;
    return found && { json: found };
  });
  backend.route(on('GET', /^\/customers\/[^/]+\/lookup$/, opts.lookup ?? ((r) => ({ json: r.path === `/customers/${SECOND.id}/lookup` ? siti : LOOKUP_OK }))));
}

/** The paths of the DELETE requests the pages sent, oldest first. */
export const deleted = (backend: FakeBackend) => backend.requests.filter((r) => r.method === 'DELETE').map((r) => r.path);

/** The JSON body of the first `method path` request the pages sent. */
export const sentBody = (backend: FakeBackend, method: string, path: string) => {
  const req = backend.requests.find((r) => r.method === method && r.path === path);
  return req?.body ? JSON.parse(req.body.toString()) : undefined;
};

/** The chat of the first of `conversations`, with its Contact Info open; the customer panel in it, if it has one. */
export async function openContactInfo(page: Page, backend: FakeBackend, conversations: Row[] = [CONV]) {
  backend.route(get('/conversations', { conversations, total: conversations.length }));
  backend.route(get(`/messages/conversation/${conversations[0].id}`, { messages: [], hasMore: false }));
  await page.goto(`/dashboard/chat?profile=${PROFILE.id}&conv=${conversations[0].id}`);
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Contact Info', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contact Info' })).toBeVisible();
  return page.getByRole('region', { name: 'Customer', exact: true });
}

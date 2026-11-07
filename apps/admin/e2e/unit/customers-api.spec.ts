// The customers routes of the admin's API client, against a stubbed fetch: each method's verb, path, query and body.
import { test, expect } from '@playwright/test';
import { api } from '@/lib/api';

const sent: Array<{ method: string; url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    sent.push({ method: init.method ?? 'GET', url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({});
  }) as unknown as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test('every customers method asks its route, with its query and body', async () => {
  await api.getCustomers();
  await api.getCustomers({ q: 'budi santoso', page: 2, pageSize: 50 });
  await api.getCustomer('cus-1');
  await api.getCustomersByPhone('6281100000001');
  await api.lookupCustomer('cus-1');
  await api.lookupCustomer('cus-1', true);
  await api.previewCustomerLookup('12 34/56'); // whatever is typed is a query value
  await api.getCustomerHistory('cus-1', 50);
  await api.linkCustomer({ externalId: '1234567890', phone: '6281100000001' });
  await api.setDefaultCustomerLink('lnk-1');
  await api.unlinkCustomer('lnk-1');
  await api.updateCustomer('cus-1', { tags: ['vip'] });
  await api.deleteCustomer('cus-1');
  await api.addCustomerNote('cus-1', 'Prefers WhatsApp');
  await api.updateCustomerNote('cus-1', 'note-1', 'Prefers calls');
  await api.deleteCustomerNote('cus-1', 'note-1');
  await api.getCustomerConfig();
  await api.updateCustomerConfig({ idLabel: 'ID Pelanggan', secret: '' });
  await api.testCustomerConfig('1234567890');
  expect(sent).toEqual([
    { method: 'GET', url: '/api/v1/customers', body: undefined },
    { method: 'GET', url: '/api/v1/customers?q=budi+santoso&page=2&pageSize=50', body: undefined },
    { method: 'GET', url: '/api/v1/customers/cus-1', body: undefined },
    { method: 'GET', url: '/api/v1/customers/by-phone/6281100000001', body: undefined },
    { method: 'GET', url: '/api/v1/customers/cus-1/lookup', body: undefined },
    { method: 'GET', url: '/api/v1/customers/cus-1/lookup?refresh=true', body: undefined },
    { method: 'GET', url: '/api/v1/customers/lookup?externalId=12+34%2F56', body: undefined },
    { method: 'GET', url: '/api/v1/customers/cus-1/history?limit=50', body: undefined },
    { method: 'POST', url: '/api/v1/customers/links', body: { externalId: '1234567890', phone: '6281100000001' } },
    { method: 'POST', url: '/api/v1/customers/links/lnk-1/use', body: undefined },
    { method: 'DELETE', url: '/api/v1/customers/links/lnk-1', body: undefined },
    { method: 'PATCH', url: '/api/v1/customers/cus-1', body: { tags: ['vip'] } },
    { method: 'DELETE', url: '/api/v1/customers/cus-1', body: undefined },
    { method: 'POST', url: '/api/v1/customers/cus-1/notes', body: { body: 'Prefers WhatsApp' } },
    { method: 'PATCH', url: '/api/v1/customers/cus-1/notes/note-1', body: { body: 'Prefers calls' } },
    { method: 'DELETE', url: '/api/v1/customers/cus-1/notes/note-1', body: undefined },
    { method: 'GET', url: '/api/v1/customers/config', body: undefined },
    { method: 'PUT', url: '/api/v1/customers/config', body: { idLabel: 'ID Pelanggan', secret: '' } },
    { method: 'POST', url: '/api/v1/customers/config/test', body: { externalId: '1234567890' } },
  ]);
});

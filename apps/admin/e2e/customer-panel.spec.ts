// The customer panel in a one-to-one chat's Contact Info: the number's IDs, its default first; what the lookup says of
// the one shown; linking another ID; the details typed by hand while no lookup is set up; the tags and the notes. An
// agent (owner, admin, member) works the panel and a viewer reads it; a group, or a number WhatsApp hides, has none.
import { test, expect, gate, get, on, rendered, requestEnded, toasts, ME, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';
import {
  ADA, BY_PHONE, CONV, CUSTOMER, LOOKUP_DATA, LOOKUP_OK, MANUAL, NOW, PHONE, SECOND, customerBackend, deleted, lookupAnswer, openContactInfo, sentBody,
} from './support/customers';
import type { Locator, Page } from '@playwright/test';

const picker = (panel: Locator) => panel.getByRole('combobox', { name: 'ID Pelanggan' });
const linkField = (panel: Locator) => panel.getByRole('textbox', { name: 'New ID Pelanggan' });
const notes = (panel: Locator) => panel.getByRole('list', { name: 'Notes' }).getByRole('listitem');
/** The queries of the lookups asked for `id`, oldest first. */
const lookups = (backend: FakeBackend, id = CUSTOMER.id) =>
  backend.requests.filter((r) => r.path === `/customers/${id}/lookup`).map((r) => r.query.toString());
const json = (body: Buffer | null) => JSON.parse(String(body));
const sentTo = (backend: FakeBackend, method: string, path: string) => backend.requests.some((r) => r.method === method && r.path === path);
/** The agent picks the second ID while `slow` holds a save of the first; the save is answered once its details are shown. */
async function answerAfterPicking(page: Page, panel: Locator, slow: ReturnType<typeof gate>, saved: string) {
  await picker(panel).click();
  await page.getByRole('option', { name: '9876543210 · Siti Rahayu' }).click();
  await expect(picker(panel)).toHaveText('9876543210 · Siti Rahayu');
  await expect(panel.getByText('Siti Rahayu', { exact: true })).toBeVisible(); // its details, with the lookup's name
  const answered = requestEnded(page, saved);
  slow.open();
  await answered;
  await rendered(page);
}

test('shows the number’s default ID and what the lookup says of it, every value as text', async ({ page, backend }) => {
  // The endpoint is another system's: its name, its values and its section titles are text, never markup.
  const markup = (n: number) => `<img src=x onerror="window.__injected=${n}">`;
  customerBackend(backend, {
    lookup: {
      json: lookupAnswer('ok', {
        ...LOOKUP_DATA,
        name: markup(1),
        fields: [...LOOKUP_DATA.fields, { label: 'Catatan', value: markup(2) }],
        sections: [...LOOKUP_DATA.sections, { title: markup(3), rows: [] }],
      }),
    },
  });
  const panel = await openContactInfo(page, backend);
  await expect(picker(panel)).toContainText('1234567890'); // the number's default
  for (const text of ['Alamat', 'Jl. Contoh No. 1', 'Tarif/Daya', 'R1 / 1300 VA', 'Tagihan', 'Okt 2026', 'Rp 245.000 (lunas)', markup(1), markup(2), markup(3)]) {
    await expect(panel.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(panel.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__injected)).toBeUndefined();
  await expect(panel.getByRole('button', { name: 'Refresh' })).toBeVisible();
  expect(lookups(backend)).not.toContain('refresh=true'); // opening the panel uses the cache
  await expectAccessible(page, 'section[aria-labelledby]');
});

test('an ID the lookup does not know says so, and Refresh asks again past the cache', async ({ page, backend }) => {
  customerBackend(backend, { lookup: { json: lookupAnswer('not_found') } });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('Not found: the lookup has no customer with this ID.')).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => lookups(backend).filter((q) => q === 'refresh=true')).toHaveLength(1);
  await expect(panel.getByRole('button', { name: 'Refresh' })).toBeFocused();
});

test('Refresh on what the lookup says asks again past the cache', async ({ page, backend }) => {
  customerBackend(backend);
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
  await panel.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => lookups(backend).filter((q) => q === 'refresh=true')).toHaveLength(1);
});

test('an unavailable lookup offers Retry, which asks the endpoint again', async ({ page, backend }) => {
  let up = false;
  customerBackend(backend, { lookup: () => ({ json: up ? LOOKUP_OK : lookupAnswer('unavailable') }) });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('The lookup is unavailable right now.')).toBeVisible();
  const before = lookups(backend).length;
  up = true;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByText('Budi Santoso', { exact: true })).toBeVisible();
  expect(lookups(backend).slice(before)).toEqual(['']); // the server caches no unavailable answer: no refresh needed
});

test('a Retry that finds the customer hands the focus to Refresh, which takes its place', async ({ page, backend }) => {
  let up = false;
  customerBackend(backend, { lookup: () => ({ json: up ? LOOKUP_OK : lookupAnswer('unavailable') }) });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('The lookup is unavailable right now.')).toBeVisible();
  up = true;
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByRole('button', { name: 'Refresh' })).toBeFocused();
});

test('says it is looking while the endpoint is slow', async ({ page, backend }) => {
  const slow = gate();
  customerBackend(backend, {
    lookup: async () => {
      await slow.passed;
      return { json: LOOKUP_OK };
    },
  });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByRole('status').filter({ hasText: 'Looking up…' })).toBeVisible();
  slow.open();
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
  await expect(panel.getByText('Looking up…')).toHaveCount(0);
});

test('with no lookup set up, shows the details typed by hand, with nothing to refresh', async ({ page, backend }) => {
  customerBackend(backend, {
    config: MANUAL,
    customers: [{ ...CUSTOMER, manualFields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }] }],
    lookup: { json: lookupAnswer('not_configured') },
  });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('No lookup is set up: these details are filled in by hand.')).toBeVisible();
  await expect(panel.getByText('Budi Santoso', { exact: true })).toBeVisible();
  await expect(panel.getByText('Jl. Contoh No. 1', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Edit details' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
});

test('a number with no ID linked yet says so, and without the organization’s label it says Customer ID', async ({ page, backend }) => {
  customerBackend(backend, { byPhone: [] });
  backend.route(on('GET', '/customers/config', { status: 500, json: { message: 'Internal server error' } }));
  const config = requestEnded(page, '/customers/config');
  const panel = await openContactInfo(page, backend);
  await config;
  await rendered(page);
  await expect(panel.getByText('No Customer ID is linked to this number yet.')).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'New Customer ID' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Link Customer ID' })).toBeDisabled(); // nothing typed yet
  await expect(panel.getByRole('combobox')).toHaveCount(0);
});

test('IDs of the number the server cannot give are said so, with Retry: not taken for none linked', async ({ page, backend }) => {
  customerBackend(backend);
  backend.route(on('GET', `/customers/by-phone/${PHONE}`, { status: 500, json: { message: 'Internal server error' } }));
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByRole('alert')).toHaveText('Could not read what is linked to this number: Internal server error');
  await expect(panel.getByText(/is linked to this number yet/)).toHaveCount(0);
  await expect(linkField(panel)).toHaveCount(0); // what is linked is not known: nothing to add to
  backend.route(get(`/customers/by-phone/${PHONE}`, BY_PHONE));
  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(linkField(panel)).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Customer' })).toBeFocused(); // Retry went: the focus is not left to the page
});

test('follows the open chat: another chat’s number shows its own customer', async ({ page, backend }) => {
  const other = { ...CONV, id: 'conv-2', jid: '6281100000002@s.whatsapp.net', contactId: 'ct-2', name: 'Bu Siti' };
  customerBackend(backend);
  backend.route(get('/customers/by-phone/6281100000002', []));
  const panel = await openContactInfo(page, backend, [CONV, other]);
  await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
  await page.getByRole('heading', { name: 'Bu Siti' }).first().click();
  await expect(panel.getByText('No ID Pelanggan is linked to this number yet.')).toBeVisible();
  await expect(picker(panel)).toHaveCount(0);
});

test('another chat starts the panel over: nothing typed to link, nothing of the last chat’s customer, while its number is read', async ({ page, backend }) => {
  const other = { ...CONV, id: 'conv-2', jid: '6281100000002@s.whatsapp.net', contactId: 'ct-2', name: 'Bu Siti' };
  const slow = gate();
  customerBackend(backend);
  backend.route(on('GET', '/customers/by-phone/6281100000002', async () => {
    await slow.passed;
    return { json: [] };
  }));
  const panel = await openContactInfo(page, backend, [CONV, other]);
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible();
  await linkField(panel).fill('5550001111'); // typed, not linked
  await page.getByRole('heading', { name: 'Bu Siti' }).first().click();
  await expect(panel.getByText('Loading…')).toBeVisible();
  await expect(linkField(panel)).toHaveValue('');
  await expect(panel.getByText('R1 / 1300 VA')).toHaveCount(0);
  await expect(picker(panel)).toHaveCount(0);
  slow.open();
  await expect(panel.getByText('No ID Pelanggan is linked to this number yet.')).toBeVisible();
});

for (const [what, conv] of [
  ['a group chat', { ...CONV, jid: '120363000000000001@g.us', type: 'group', name: 'Grup Pelanggan' }],
  ['a chat with a number WhatsApp hides', { ...CONV, jid: '200000000000001@lid' }],
] as const) {
  test(`${what} has no customer panel, and asks for no customer`, async ({ page, backend }) => {
    customerBackend(backend);
    const panel = await openContactInfo(page, backend, [conv]);
    await expect(page.getByText('WhatsApp ID')).toBeVisible(); // the rest of Contact Info is there
    await expect(panel).toHaveCount(0);
    expect(backend.requests.filter((r) => r.path.startsWith('/customers')).map((r) => r.path)).toEqual([]);
  });
}

test('an admin edits and deletes another’s note too, and Cancel on the question keeps it', async ({ page, backend }) => {
  customerBackend(backend);
  backend.route(on('PATCH', '/customers/cus-1/notes/note-2', (r) => ({ json: { ...CUSTOMER.notes[0], body: json(r.body).body } })));
  backend.route(on('DELETE', '/customers/cus-1/notes/note-2', { json: { success: true } }));
  const panel = await openContactInfo(page, backend);
  const theirs = notes(panel).filter({ hasText: 'Mia Member' });
  await theirs.getByRole('button', { name: 'Edit note' }).click();
  await panel.getByRole('textbox', { name: 'Edit note' }).fill('Asked about the October and November bills');
  await expectAccessible(page, 'section[aria-labelledby]');
  await panel.getByRole('button', { name: 'Save note' }).click();
  await expect(theirs).toContainText('Asked about the October and November bills');
  expect(sentBody(backend, 'PATCH', '/customers/cus-1/notes/note-2')).toEqual({ body: 'Asked about the October and November bills' });
  page.once('dialog', (d) => d.dismiss());
  await theirs.getByRole('button', { name: 'Delete note' }).click();
  await expect(theirs).toHaveCount(1);
  expect(backend.requests.some((r) => r.method === 'DELETE')).toBe(false);
  page.once('dialog', (d) => d.accept());
  await theirs.getByRole('button', { name: 'Delete note' }).click();
  await expect(theirs).toHaveCount(0);
  expect(deleted(backend)).toEqual(['/customers/cus-1/notes/note-2']); // the customer's ID, then the note's
});

test('a note answered after the agent picked another ID stays out of that ID’s notes', async ({ page, backend }) => {
  const slow = gate();
  customerBackend(backend);
  backend.route(on('POST', '/customers/cus-1/notes', async (r) => {
    await slow.passed;
    return { status: 201, json: { id: 'note-3', body: json(r.body).body, createdAt: NOW, updatedAt: NOW, author: ADA } };
  }));
  const panel = await openContactInfo(page, backend);
  await panel.getByRole('textbox', { name: 'New note' }).fill('Called back about the meter');
  await panel.getByRole('button', { name: 'Add note' }).click();
  await expect.poll(() => sentTo(backend, 'POST', '/customers/cus-1/notes')).toBe(true);
  await answerAfterPicking(page, panel, slow, '/customers/cus-1/notes');
  await expect(panel.getByText('No notes yet.')).toBeVisible();
  await expect(panel.getByText('Called back about the meter')).toHaveCount(0);
});

test('tags answered after the agent picked another ID leave that ID’s details as they are', async ({ page, backend }) => {
  const slow = gate();
  customerBackend(backend);
  backend.route(on('PATCH', '/customers/cus-1', async (r) => {
    await slow.passed;
    return { json: { ...CUSTOMER, tags: json(r.body).tags } };
  }));
  const panel = await openContactInfo(page, backend);
  await panel.getByRole('textbox', { name: 'New tag' }).fill('billing');
  await panel.getByRole('button', { name: 'Add tag' }).click();
  await expect.poll(() => sentTo(backend, 'PATCH', '/customers/cus-1')).toBe(true);
  await answerAfterPicking(page, panel, slow, '/customers/cus-1');
  await expect(picker(panel)).toHaveText('9876543210 · Siti Rahayu');
  await expect(panel.getByText('No tags yet.')).toBeVisible();
  await expect(panel.getByText('R1 / 1300 VA')).toHaveCount(0); // Budi Santoso's lookup
});

test('the picker names an ID as its details were renamed', async ({ page, backend }) => {
  customerBackend(backend, { config: MANUAL, lookup: { json: lookupAnswer('not_configured') } });
  backend.route(on('PATCH', '/customers/cus-1', (r) => ({ json: { ...CUSTOMER, ...json(r.body) } })));
  const panel = await openContactInfo(page, backend);
  await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
  await panel.getByRole('button', { name: 'Edit details' }).click();
  await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Budi S.');
  await panel.getByRole('button', { name: 'Save details' }).click();
  await expect(panel.getByText('Budi S.', { exact: true })).toBeVisible();
  await expect(picker(panel)).toHaveText('1234567890 · Budi S.');
  await picker(panel).click();
  await expect(page.getByRole('option')).toHaveText(['1234567890 · Budi S.', '9876543210 · Siti Rahayu']);
});

test('the picker names an ID by the name the lookup gave it', async ({ page, backend }) => {
  customerBackend(backend, {
    customers: [{ ...CUSTOMER, displayName: null }, SECOND],
    byPhone: [{ ...BY_PHONE[0], displayName: null }, BY_PHONE[1]],
  });
  const panel = await openContactInfo(page, backend);
  await expect(panel.getByText('R1 / 1300 VA')).toBeVisible(); // the lookup answered, with the name Budi Santoso
  await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
});

test('picks follow one another to the server: the last pick is the last default it is told', async ({ page, backend }) => {
  const slow = gate();
  const told: string[] = [];
  customerBackend(backend);
  backend.route(on('POST', /^\/customers\/links\/[^/]+\/use$/, async (r) => {
    const linkId = r.path.split('/')[3];
    if (linkId === 'lnk-2') await slow.passed; // the first pick's request is the slow one
    told.push(linkId);
    return { status: 201, json: { id: linkId, phone: PHONE, lastUsedAt: NOW, createdAt: NOW, linkedBy: null } };
  }));
  const panel = await openContactInfo(page, backend);
  await picker(panel).click();
  await page.getByRole('option', { name: '9876543210 · Siti Rahayu' }).click();
  await picker(panel).click();
  await page.getByRole('option', { name: '1234567890 · Budi Santoso' }).click();
  await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
  slow.open();
  await expect.poll(() => told).toEqual(['lnk-2', 'lnk-1']);
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('picks another ID: the panel shows it, and it becomes the number’s default', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('POST', '/customers/links/lnk-2/use', { json: { id: 'lnk-2', phone: PHONE, lastUsedAt: NOW, createdAt: NOW, linkedBy: null } }));
    const panel = await openContactInfo(page, backend);
    await picker(panel).click();
    await expect(page.getByRole('option')).toHaveText(['1234567890 · Budi Santoso', '9876543210 · Siti Rahayu']);
    await page.getByRole('option', { name: '9876543210 · Siti Rahayu' }).click();
    await expect(picker(panel)).toHaveText('9876543210 · Siti Rahayu');
    await expect(panel.getByText('Siti Rahayu', { exact: true })).toBeVisible(); // its lookup
    await expect.poll(() => backend.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/customers/links/lnk-2/use']);
  });

  test('sees what the lookup says of a typed ID before linking it, and links one it does not know', async ({ page, backend }) => {
    const NEW = {
      ...CUSTOMER, id: 'cus-3', externalId: '5550002222', displayName: null, tags: [], notes: [],
      links: [{ id: 'lnk-3', phone: PHONE, lastUsedAt: NOW, createdAt: NOW, linkedBy: ADA }],
    };
    const preview: Record<string, unknown> = {
      '5550001111': lookupAnswer('ok', { name: 'Rina Wati', fields: [], sections: [] }),
      '5550002222': lookupAnswer('not_found'),
      '5550003333': lookupAnswer('unavailable'),
    };
    customerBackend(backend, {
      customers: [CUSTOMER, NEW],
      lookup: (r) => ({ json: r.path === '/customers/cus-3/lookup' ? lookupAnswer('not_found') : LOOKUP_OK }),
    });
    backend.route(on('GET', '/customers/lookup', (r) => ({ json: preview[r.query.get('externalId') ?? ''] })));
    backend.route(on('POST', '/customers/links', { status: 201, json: { created: true, customer: NEW, link: NEW.links[0] } }));
    const panel = await openContactInfo(page, backend);
    const field = linkField(panel);
    await field.fill('5550001111');
    await expect(field).toHaveAccessibleDescription('Found: Rina Wati');
    await field.fill('5550003333');
    await expect(field).toHaveAccessibleDescription("Can't check now");
    await field.fill('5550002222');
    await expect(field).toHaveAccessibleDescription('Not found');
    // Not found only warns: the ID can still be linked.
    await panel.getByRole('button', { name: 'Link ID Pelanggan' }).click();
    await expect(toasts(page).getByText('ID Pelanggan 5550002222 linked')).toBeVisible();
    expect(sentBody(backend, 'POST', '/customers/links')).toEqual({ externalId: '5550002222', phone: PHONE });
    await expect(picker(panel)).toHaveText('5550002222');
    await expect(panel.getByText('Not found: the lookup has no customer with this ID.')).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(field).toHaveAccessibleDescription('');
  });

  test('linking an ID the number already has makes it the default again, with no error', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('POST', '/customers/links', { status: 200, json: { created: false, customer: SECOND, link: SECOND.links[0] } }));
    const panel = await openContactInfo(page, backend);
    await linkField(panel).fill('9876543210');
    await panel.getByRole('button', { name: 'Link ID Pelanggan' }).click();
    await expect(toasts(page).getByText('ID Pelanggan 9876543210 was already linked')).toBeVisible();
    expect(sentBody(backend, 'POST', '/customers/links')).toEqual({ externalId: '9876543210', phone: PHONE });
    await expect(picker(panel)).toHaveText('9876543210 · Siti Rahayu');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(linkField(panel)).toHaveValue('');
    await picker(panel).click();
    await expect(page.getByRole('option')).toHaveText(['9876543210 · Siti Rahayu', '1234567890 · Budi Santoso']);
  });

  test('a link the server refuses says why beside the field, and links nothing', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('POST', '/customers/links', { status: 400, json: { statusCode: 400, message: 'Invalid customer ID', error: 'Bad Request' } }));
    const panel = await openContactInfo(page, backend);
    const field = linkField(panel);
    await field.fill('12/34');
    await panel.getByRole('button', { name: 'Link ID Pelanggan' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Invalid customer ID');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveValue('12/34');
    await expect(picker(panel)).toHaveText('1234567890 · Budi Santoso');
    await field.fill('1234');
    await expect(panel.getByRole('alert')).toHaveCount(0); // typing again clears it
  });

  test('with no lookup set up, edits the name and the fields typed by hand', async ({ page, backend }) => {
    customerBackend(backend, {
      config: MANUAL,
      customers: [{ ...CUSTOMER, displayName: 'Budi', manualFields: [] }],
      lookup: { json: lookupAnswer('not_configured') },
    });
    backend.route(on('PATCH', '/customers/cus-1', (r) => ({ json: { ...CUSTOMER, ...json(r.body) } })));
    const panel = await openContactInfo(page, backend);
    await panel.getByRole('button', { name: 'Edit details' }).click();
    await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Budi Santoso');
    await panel.getByRole('button', { name: 'Add field' }).click();
    await panel.getByRole('textbox', { name: 'Field 1 label' }).fill('Alamat');
    await panel.getByRole('textbox', { name: 'Field 1 value' }).fill('Jl. Contoh No. 1');
    await expectAccessible(page, 'section[aria-labelledby]');
    await panel.getByRole('button', { name: 'Save details' }).click();
    await expect(panel.getByText('Jl. Contoh No. 1', { exact: true })).toBeVisible();
    expect(sentBody(backend, 'PATCH', '/customers/cus-1')).toEqual({ displayName: 'Budi Santoso', manualFields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }] });
    await expect(panel.getByText('Budi Santoso', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Edit details' })).toBeVisible();
  });

  test('clearing the name sends it empty, which the server reads as no name', async ({ page, backend }) => {
    customerBackend(backend, { config: MANUAL, lookup: { json: lookupAnswer('not_configured') } });
    // As the server takes it: a name sent empty clears it, and a name not sent leaves it.
    backend.route(on('PATCH', '/customers/cus-1', (r) => {
      const { displayName } = json(r.body);
      return { json: { ...CUSTOMER, ...(displayName === undefined ? {} : { displayName: displayName.trim() || null }) } };
    }));
    const panel = await openContactInfo(page, backend);
    await panel.getByRole('button', { name: 'Edit details' }).click();
    await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('');
    await panel.getByRole('button', { name: 'Save details' }).click();
    await expect(panel.getByRole('button', { name: 'Edit details' })).toBeVisible();
    expect(sentBody(backend, 'PATCH', '/customers/cus-1')).toEqual({ displayName: '', manualFields: [] });
    await expect(panel.getByText('Budi Santoso', { exact: true })).toHaveCount(0);
    await expect(picker(panel)).toHaveText('1234567890');
  });

  test('a save of the typed details the server refuses says why, and keeps what was typed', async ({ page, backend }) => {
    customerBackend(backend, { config: MANUAL, lookup: { json: lookupAnswer('not_configured') } });
    backend.route(on('PATCH', '/customers/cus-1', { status: 409, json: { statusCode: 409, message: 'A lookup endpoint is configured: the name and fields come from it', error: 'Conflict' } }));
    const panel = await openContactInfo(page, backend);
    await panel.getByRole('button', { name: 'Edit details' }).click();
    await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Budi S.');
    await panel.getByRole('button', { name: 'Save details' }).click();
    await expect(toasts(page).getByText('A lookup endpoint is configured: the name and fields come from it')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Budi S.');
  });

  test('reads the notes newest first, adds one, and edits and deletes their own but not another’s', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('POST', '/customers/cus-1/notes', (r) => ({ status: 201, json: { id: 'note-3', body: json(r.body).body, createdAt: NOW, updatedAt: NOW, author: ADA } })));
    backend.route(on('PATCH', '/customers/cus-1/notes/note-1', (r) => ({ json: { ...CUSTOMER.notes[1], body: json(r.body).body } })));
    backend.route(on('DELETE', '/customers/cus-1/notes/note-1', { json: { success: true } }));
    page.on('dialog', (d) => d.accept());
    const panel = await openContactInfo(page, backend);
    await expect(notes(panel)).toHaveText([/Asked about the October bill.*Mia Member/, /Prefers WhatsApp to calls.*Ada Agent/]);
    const theirs = notes(panel).filter({ hasText: 'Mia Member' });
    for (const name of ['Edit note', 'Delete note']) await expect(theirs.getByRole('button', { name })).toHaveCount(0);

    await panel.getByRole('textbox', { name: 'New note' }).fill('Called back about the meter');
    await panel.getByRole('button', { name: 'Add note' }).click();
    await expect(notes(panel).first()).toContainText('Called back about the meter');
    expect(sentBody(backend, 'POST', '/customers/cus-1/notes')).toEqual({ body: 'Called back about the meter' });
    await expect(panel.getByRole('textbox', { name: 'New note' })).toHaveValue('');

    await notes(panel).filter({ hasText: 'Prefers WhatsApp to calls' }).getByRole('button', { name: 'Edit note' }).click();
    await panel.getByRole('textbox', { name: 'Edit note' }).fill('Prefers WhatsApp, never calls');
    await panel.getByRole('button', { name: 'Save note' }).click();
    const edited = notes(panel).filter({ hasText: 'Prefers WhatsApp, never calls' });
    await expect(edited).toHaveCount(1);
    expect(sentBody(backend, 'PATCH', '/customers/cus-1/notes/note-1')).toEqual({ body: 'Prefers WhatsApp, never calls' });

    await edited.getByRole('button', { name: 'Delete note' }).click();
    await expect(edited).toHaveCount(0);
    await expect(notes(panel)).toHaveCount(2);
    expect(deleted(backend)).toEqual(['/customers/cus-1/notes/note-1']);
  });

  test('adds and removes the customer’s tags, beside the contact’s own, which stay read-only', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('PATCH', '/customers/cus-1', (r) => ({ json: { ...CUSTOMER, tags: json(r.body).tags } })));
    const panel = await openContactInfo(page, backend);
    const tags = panel.getByRole('list', { name: 'Customer tags' }).getByRole('listitem');
    await expect(panel.getByRole('list', { name: 'Contact tags' })).toHaveText('vip');
    await expect(panel.getByRole('button', { name: 'Remove tag vip' })).toHaveCount(0);
    const contacts = backend.requests.find((r) => r.path === '/contacts');
    expect([contacts?.query.get('profileId'), contacts?.query.get('search')]).toEqual([CONV.profileId, PHONE]);
    await panel.getByRole('textbox', { name: 'New tag' }).fill('billing');
    await panel.getByRole('button', { name: 'Add tag' }).click();
    await expect(tags).toHaveText(['priority', 'billing']);
    await expect(panel.getByRole('textbox', { name: 'New tag' })).toHaveValue('');
    await panel.getByRole('button', { name: 'Remove tag priority' }).click();
    await expect(tags).toHaveText(['billing']);
    expect(backend.requests.filter((r) => r.method === 'PATCH').map((r) => json(r.body))).toEqual([{ tags: ['priority', 'billing'] }, { tags: ['billing'] }]);
  });

  test('keeps the focus in a note’s edit: in its field, back on Edit when it closes, on the new note after a delete', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('PATCH', '/customers/cus-1/notes/note-1', (r) => ({ json: { ...CUSTOMER.notes[1], body: json(r.body).body } })));
    backend.route(on('DELETE', '/customers/cus-1/notes/note-1', { json: { success: true } }));
    page.on('dialog', (d) => d.accept());
    const panel = await openContactInfo(page, backend);
    const mine = notes(panel).filter({ hasText: 'Prefers WhatsApp to calls' });
    const field = panel.getByRole('textbox', { name: 'Edit note' });
    await mine.getByRole('button', { name: 'Edit note' }).click();
    await expect(field).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(mine.getByRole('button', { name: 'Edit note' })).toBeFocused();
    await mine.getByRole('button', { name: 'Edit note' }).click();
    await field.fill('Prefers WhatsApp, never calls');
    await panel.getByRole('button', { name: 'Save note' }).click();
    const edited = notes(panel).filter({ hasText: 'Prefers WhatsApp, never calls' });
    await expect(edited.getByRole('button', { name: 'Edit note' })).toBeFocused();
    await edited.getByRole('button', { name: 'Delete note' }).click();
    await expect(edited).toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: 'New note' })).toBeFocused();
  });

  test('keeps the focus in the typed details’ edit: in the name, and back on Edit details when it closes', async ({ page, backend }) => {
    customerBackend(backend, { config: MANUAL, lookup: { json: lookupAnswer('not_configured') } });
    backend.route(on('PATCH', '/customers/cus-1', (r) => ({ json: { ...CUSTOMER, ...json(r.body) } })));
    const panel = await openContactInfo(page, backend);
    const edit = panel.getByRole('button', { name: 'Edit details' });
    const name = panel.getByRole('textbox', { name: 'Name', exact: true });
    await edit.click();
    await expect(name).toBeFocused();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(edit).toBeFocused();
    await edit.click();
    await name.fill('Budi S.');
    await panel.getByRole('button', { name: 'Save details' }).click();
    await expect(edit).toBeFocused();
  });

  test('removing a tag leaves the focus in the new tag field', async ({ page, backend }) => {
    customerBackend(backend);
    backend.route(on('PATCH', '/customers/cus-1', (r) => ({ json: { ...CUSTOMER, tags: json(r.body).tags } })));
    const panel = await openContactInfo(page, backend);
    await panel.getByRole('button', { name: 'Remove tag priority' }).click();
    await expect(panel.getByText('No tags yet.')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'New tag' })).toBeFocused();
  });
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('picks another ID only to look at it, which leaves the default as it was, and has nothing to link', async ({ page, backend }) => {
    customerBackend(backend);
    const panel = await openContactInfo(page, backend);
    await picker(panel).click();
    await page.getByRole('option', { name: '9876543210 · Siti Rahayu' }).click();
    await expect(panel.getByText('Siti Rahayu', { exact: true })).toBeVisible();
    await page.waitForTimeout(500); // a default change would be out by now
    expect(backend.requests.filter((r) => r.method !== 'GET').map((r) => r.path)).toEqual([]);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Link / })).toHaveCount(0);
  });

  test('reads the notes, the tags and the typed details, and changes none of them', async ({ page, backend }) => {
    customerBackend(backend, {
      config: MANUAL,
      customers: [{ ...CUSTOMER, manualFields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }] }],
      lookup: { json: lookupAnswer('not_configured') },
    });
    const panel = await openContactInfo(page, backend);
    await expect(notes(panel)).toHaveCount(2);
    await expect(panel.getByRole('list', { name: 'Customer tags' })).toHaveText('priority');
    await expect(panel.getByText('Jl. Contoh No. 1', { exact: true })).toBeVisible();
    for (const name of ['Edit details', 'Add note', 'Edit note', 'Delete note', 'Add tag', 'Remove tag priority']) {
      await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(panel.getByRole('textbox')).toHaveCount(0);
  });

  test('is told when no ID is linked to the number', async ({ page, backend }) => {
    customerBackend(backend, { byPhone: [] });
    const panel = await openContactInfo(page, backend);
    await expect(panel.getByText('No ID Pelanggan is linked to this number yet.')).toBeVisible();
    await expect(panel.getByRole('textbox')).toHaveCount(0);
  });
});

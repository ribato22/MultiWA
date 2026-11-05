// The lookup's answer format: what a 200 answer may hold, read as the API passes it on, and what makes it unavailable.
import { describe, expect, it } from 'vitest';
import { parseLookupBody } from './lookup';

const pairs = (n: number, label = 'Daya', value = '1300 VA') => Array.from({ length: n }, () => ({ label, value }));

describe('parseLookupBody', () => {
  const full = {
    id: '1234567890',
    name: 'Budi Santoso',
    fields: [{ label: 'Alamat', value: 'Jl. Contoh No. 1' }, { label: 'Tarif/Daya', value: 'R1 / 1300 VA' }],
    sections: [{ title: 'Tagihan', rows: [{ label: 'Okt 2026', value: 'Rp 245.000 (lunas)' }] }],
  };

  it('answers the parts as they were sent, and drops the keys it does not know', () => {
    expect(parseLookupBody({ ...full, balance: 3, fields: full.fields.map((f) => ({ ...f, color: 'red' })) })).toEqual(full);
  });

  it('takes every part as optional, and null as absent', () => {
    expect(parseLookupBody({})).toEqual({ fields: [], sections: [] });
    expect(parseLookupBody({ id: null, name: 'Budi Santoso', fields: null, sections: [{ title: 'Kosong', rows: null }] })).toEqual({
      name: 'Budi Santoso', fields: [], sections: [{ title: 'Kosong', rows: [] }],
    });
  });

  it('takes the limits themselves', () => {
    const most = {
      id: '9'.repeat(64),
      name: 'x'.repeat(200),
      fields: pairs(50, 'l'.repeat(60), 'v'.repeat(500)),
      sections: Array.from({ length: 10 }, () => ({ title: 't'.repeat(60), rows: pairs(50) })),
    };
    expect(parseLookupBody(most)).toEqual(most);
  });

  it.each([
    ['a list', [{ name: 'Budi Santoso' }]],
    ['text', 'Budi Santoso'],
    ['null', null],
    ['an id over 64 characters', { id: '9'.repeat(65) }],
    ['an id that is a number', { id: 1234567890 }],
    ['a name over 200 characters', { name: 'x'.repeat(201) }],
    ['51 fields', { fields: pairs(51) }],
    ['fields that are not a list', { fields: { label: 'Daya', value: '1300 VA' } }],
    ['a label over 60 characters', { fields: [{ label: 'l'.repeat(61), value: 'v' }] }],
    ['a value over 500 characters', { fields: [{ label: 'l', value: 'v'.repeat(501) }] }],
    ['a value that is a number', { fields: [{ label: 'Daya', value: 1300 }] }],
    ['a field without its label', { fields: [{ value: '1300 VA' }] }],
    ['11 sections', { sections: Array.from({ length: 11 }, () => ({ title: 't' })) }],
    ['a section without its title', { sections: [{ rows: [] }] }],
    ['a title over 60 characters', { sections: [{ title: 't'.repeat(61) }] }],
    ['51 rows in a section', { sections: [{ title: 'Tagihan', rows: pairs(51) }] }],
  ])('refuses %s', (_what, body) => {
    expect(parseLookupBody(body)).toBeNull();
  });
});

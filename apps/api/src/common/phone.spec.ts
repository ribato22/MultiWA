// Phone numbers as contacts and customers store them. normalizePhone is the rule contacts have always used, kept as it
// was; linkablePhone adds what a customer link needs: a phone number, never a group or another kind of chat.
import { describe, expect, it } from 'vitest';
import { linkablePhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['081234567890', '6281234567890'],
    ['+62 812-3456-7890', '6281234567890'],
    ['(0812) 3456-7890', '6281234567890'],
    ['6281234567890', '6281234567890'],
    ['+1 (415) 555-2671', '14155552671'],
    ['0062 812', '62062812'], // only the first 0 becomes 62
    ['6281234567890@s.whatsapp.net', '6281234567890'], // the digits of a JID, as before
    ['120363000000000001@g.us', '120363000000000001'], // contacts never refused a group's digits
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe('linkablePhone', () => {
  it.each([
    ['0811-0000-0001', '6281100000001'],
    ['+62 811 0000 0001', '6281100000001'],
    ['6281100000001@s.whatsapp.net', '6281100000001'],
    ['6281100000001@c.us', '6281100000001'],
    ['6281100000001:12@s.whatsapp.net', '6281100000001'], // a multi-device JID: the device is not part of the number
    ['12345678', '12345678'],
    ['123456789012345', '123456789012345'],
  ])('links %j as %j', (input, expected) => {
    expect(linkablePhone(input)).toBe(expected);
  });

  it.each([
    ['a group', '120363000000000001@g.us'],
    ['an @lid identity', '123456789012345@lid'],
    ['a broadcast list', '6281100000001@broadcast'],
    ['7 digits', '1234567'],
    ['16 digits', '1234567890123456'],
    ['a name', 'Budi Santoso'],
    ['a JID without a number', '@s.whatsapp.net'],
  ])('has no number for %s', (_what, input) => {
    expect(linkablePhone(input)).toBeNull();
  });
});

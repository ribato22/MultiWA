// Recipient validation tests for the send path.
//
// Covers the shared core predicate isWhatsAppRecipient (source of truth for the
// DTO gate AND both normalizeJid guards) and the BaseMessageDto.to DTO decorator.
// Case set is the empirically-confirmed list from the adversarial review:
//  - accepts phone formats with separators/whitespace + every WA JID form;
//  - rejects raw names, separator-only "phones" that collapse to a junk JID,
//    short numbers below the 7-digit floor, and JIDs with unknown/garbage domains.

import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { isWhatsAppRecipient } from '@multiwa/core';

import { SendTextDto } from './index';

const ACCEPT = [
  '6281234567890',
  '0812-3456-7890',
  '+62 812 3456 7890',
  '(021) 123-4567', // leading-paren format (regression guard)
  '(202) 555-0143', // US parenthesized
  ' 6281234567890', // leading whitespace (CSV/copy-paste)
  '628111017195@s.whatsapp.net',
  '628111017195@c.us',
  '120363421805328930@g.us', // group
  '628111017195:12@c.us', // device-suffixed JID
  '12345@lid', // short JID local is OK (no digit-floor on JID locals)
  'status@broadcast',
];

const REJECT = [
  'Me&Me',
  'Rizky Bachtiar',
  'abc',
  '',
  '628111017195@unknown.net', // unknown domain
  'hello@world.com',
  '12345', // 5 digits < floor
  '123456', // 6 digits < floor
  '+1234', // 4 digits < floor
  '1......', // 1 digit, separators padded (the junk-JID bug)
  '1------',
  '1.2.3.4.5', // strips to 5 digits
  '.@c.us', // separator-only local
  '_@c.us',
  '-@lid',
];

describe('isWhatsAppRecipient (core predicate)', () => {
  it.each(ACCEPT)('accepts %j', (v) => {
    expect(isWhatsAppRecipient(v)).toBe(true);
  });

  it.each(REJECT)('rejects %j', (v) => {
    expect(isWhatsAppRecipient(v)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isWhatsAppRecipient(undefined)).toBe(false);
    expect(isWhatsAppRecipient(null)).toBe(false);
    expect(isWhatsAppRecipient(12345 as unknown)).toBe(false);
  });
});

function toErrors(to: unknown): string[] {
  const dto = plainToInstance(SendTextDto, { profileId: 'p1', to, text: 'hi' });
  const errors = validateSync(dto, { whitelist: true });
  const toErr = errors.find((e) => e.property === 'to');
  return toErr ? Object.keys(toErr.constraints ?? {}) : [];
}

describe('BaseMessageDto.to (@IsWhatsAppRecipient DTO gate)', () => {
  it.each(ACCEPT)('accepts %j', (to) => {
    expect(toErrors(to)).toHaveLength(0);
  });

  it.each(REJECT)('rejects %j', (to) => {
    expect(toErrors(to)).toContain('isWhatsAppRecipient');
  });
});

// MultiWA Gateway API - phone numbers
// apps/api/src/common/phone.ts

/**
 * A phone number as contacts and customers store it: its digits only, a leading 0 read as Indonesia's 62. Any other
 * country code stays as it was typed.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

/** The JIDs of a one-to-one chat: their user part is a phone number. */
const PHONE_JID = /^(s\.whatsapp\.net|c\.us)$/;

/**
 * The number a customer can be linked to, or null: a phone number or the JID of a one-to-one chat (…@s.whatsapp.net,
 * …@c.us), normalized as above, of 8 to 15 digits. A group, a broadcast list or an @lid identity has no number.
 */
export function linkablePhone(input: string): string | null {
  const at = input.indexOf('@');
  if (at >= 0 && !PHONE_JID.test(input.slice(at + 1).trim())) return null;
  const phone = normalizePhone(at >= 0 ? input.slice(0, at) : input);
  return /^\d{8,15}$/.test(phone) ? phone : null;
}

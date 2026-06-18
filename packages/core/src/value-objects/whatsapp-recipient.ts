// MultiWA Gateway Core - WhatsApp recipient validation
// packages/core/src/value-objects/whatsapp-recipient.ts
//
// Single source of truth for "is this a valid WhatsApp SEND recipient?".
// Used by the API send DTO validator (IsWhatsAppRecipient) AND both normalizeJid
// implementations (apps/api + apps/worker) so the HTTP front gate and the
// internal callers (automation rule-engine, AI actions) agree — there is no
// drift between the three normalize sites + the adapter normalizePhoneToJid.
//
// Two accepted shapes:
//   - phone: leading/trailing separators & whitespace tolerated, then digits.
//     After stripping non-digits the digit count must be in [MIN, MAX]. This
//     mirrors normalizeJid / normalizePhoneToJid which both do replace(/\D/g,'').
//     The digit-COUNT check (not raw length) is why this lives in code, not a
//     single regex: "1......" is 7 chars but 1 digit -> a junk JID.
//   - JID: a closed allowlist of WhatsApp domains + a local part that contains
//     at least one alphanumeric. Intentionally STRICTER than normalizeJid (which
//     does no domain check at all), so "hello@world.com" / "628@unknown.net" and
//     separator-only locals (".@c.us", "_@c.us", "-@lid") are rejected.

export const WHATSAPP_JID_DOMAINS = [
  's.whatsapp.net',
  'c.us',
  'g.us',
  'lid',
  'broadcast',
  'newsletter',
] as const;

// E.164 caps a number at 15 digits. A floor of 7 blocks junk shortcodes / garbage
// that would collapse to an unsendable JID, while staying below the shortest real
// MSISDN (so no legitimate number is rejected).
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 15;

// Phone shape: any leading separators/whitespace, at least one digit, then only
// phone-ish chars. Letters anywhere (a name like "Me&Me" / "Rizky Bachtiar") fail.
const PHONE_SHAPE = /^[+\s().-]*\d[\d\s().-]*$/;
const JID_LOCAL_CHARSET = /^[A-Za-z0-9._:-]+$/;
const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

export function isWhatsAppRecipient(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length === 0) return false;

  const at = s.indexOf('@');
  if (at !== -1) {
    const local = s.slice(0, at);
    const domain = s.slice(at + 1);
    if (!(WHATSAPP_JID_DOMAINS as readonly string[]).includes(domain)) return false;
    // Local part covers numeric ids, device-suffix ':' and legacy '-'.
    if (!JID_LOCAL_CHARSET.test(local)) return false;
    // Require >=1 alphanumeric so separator-only locals are rejected.
    // NOTE: a single-digit local like "0@s.whatsapp.net" still passes — a conscious
    // tradeoff, because the legitimate "12345@lid" forbids a digit-floor on JID locals.
    return HAS_ALPHANUMERIC.test(local);
  }

  if (!PHONE_SHAPE.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

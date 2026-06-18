// MultiWA Admin - centralized date/time formatting
// apps/admin/src/lib/datetime.ts
//
// Single source of truth for ALL time display in the admin. Locale id-ID,
// timezone Asia/Jakarta (WIB), 24-hour clock. Provides WhatsApp/Slack-style
// smart-relative labels for lists + plain absolute formats for tables, plus a
// full tooltip string so any abbreviated time can be hovered for the exact
// timestamp. Always render through these helpers — never call toLocale* inline.

type DateInput = Date | string | number | null | undefined;

const TZ = 'Asia/Jakarta';
const LOCALE = 'id-ID';
const DAY_MS = 86_400_000;

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

// WIB calendar-day key (YYYY-MM-DD) — for same-day / grouping comparisons.
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function yearKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(d);
}

/** "17.31" — time only, 24h, WIB. Chat bubbles. */
export function formatTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "18 Jun 2026" — date only, WIB. */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** "18 Jun 2026, 17.31" — absolute date+time, 24h, WIB. Tables, cards, scheduled. */
export function formatDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "Senin, 18 Juni 2026, 17.31 WIB" — full, unambiguous. Tooltip (title attr). */
export function formatFull(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  const s = new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${s} WIB`;
}

/**
 * Smart relative label for lists / Recent Sent / conversation previews:
 *  - <60s     → "baru saja"
 *  - <60m     → "N mnt lalu"
 *  - today    → "17.31"
 *  - yesterday→ "Kemarin 17.31"
 *  - <7 days  → "Sen 14.20"
 *  - this year→ "12 Jun"
 *  - older    → "12 Jun 2025"
 * Pair with title={formatFull(input)} so the exact timestamp is one hover away.
 */
export function formatRelative(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 0) return formatTime(d); // clock skew / future → just the time
  if (diffSec < 60) return 'baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} mnt lalu`;

  const todayKey = dayKey(now);
  const thatKey = dayKey(d);
  if (thatKey === todayKey) return formatTime(d);
  if (thatKey === dayKey(new Date(now.getTime() - DAY_MS))) return `Kemarin ${formatTime(d)}`;

  if (diffSec < 7 * 86_400) {
    const wd = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'short' }).format(d);
    return `${wd} ${formatTime(d)}`;
  }

  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
    ...(yearKey(d) === yearKey(now) ? {} : { year: 'numeric' }),
  }).format(d);
}

/** Day-separator label for chat ("Hari ini" / "Kemarin" / "Senin, 18 Juni 2026"). */
export function formatDaySeparator(input: DateInput): string {
  const d = toDate(input);
  if (!d) return '';
  const now = new Date();
  const thatKey = dayKey(d);
  if (thatKey === dayKey(now)) return 'Hari ini';
  if (thatKey === dayKey(new Date(now.getTime() - DAY_MS))) return 'Kemarin';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** WIB calendar-day key (YYYY-MM-DD) for grouping a message list into day buckets. */
export function dayBucket(input: DateInput): string {
  const d = toDate(input);
  return d ? dayKey(d) : '';
}

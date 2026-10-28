// MultiWA Gateway - Quiet-profile alarm helpers (pure, no I/O)
// apps/api/src/modules/messages/quiet-profile.ts

export interface ActiveWindow {
  /** Minutes after local midnight when silence starts to count (inclusive). */
  startMin: number;
  /** Minutes after local midnight when it stops counting (exclusive). */
  endMin: number;
  timeZone: string;
}

export const DEFAULT_ACTIVE_WINDOW: ActiveWindow = { startMin: 7 * 60, endMin: 22 * 60, timeZone: 'Asia/Jakarta' };

const pad = (n: number) => String(n).padStart(2, '0');

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** QUIET_ALARM_ACTIVE_HOURS ("07:00-22:00") + QUIET_ALARM_TIMEZONE; each falls back to its own default when missing or invalid. */
export function parseActiveWindow(hours?: string, timeZone?: string): ActiveWindow {
  const tz = timeZone?.trim() ?? '';
  const zone = tz && validTimeZone(tz) ? tz : DEFAULT_ACTIVE_WINDOW.timeZone;
  const fallback = { ...DEFAULT_ACTIVE_WINDOW, timeZone: zone };
  const m = (hours ?? '').match(/^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return fallback;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || startMin >= endMin || endMin > 24 * 60) return fallback;
  return { startMin, endMin, timeZone: zone };
}

export function windowLabel(w: ActiveWindow): string {
  const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  return `${hm(w.startMin)}-${hm(w.endMin)} ${w.timeZone}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(t: number, timeZone: string): Record<string, string> {
  let f = formatters.get(timeZone);
  if (!f) {
    // en-US, not en-GB: some ICU builds spell September "Sept" in en-GB. Only the parts are used, so the layout is ours.
    f = new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value]));
}

/**
 * Minutes of [from, to) inside the daily active window, in the window's time zone.
 * Counts minute by minute (correct across DST) and stops at `cap` — the caller passes its threshold.
 */
export function activeMinutesBetween(from: Date, to: Date, w: ActiveWindow, cap = Number.POSITIVE_INFINITY): number {
  let n = 0;
  for (let t = Math.ceil(from.getTime() / 60_000) * 60_000; t < to.getTime() && n < cap; t += 60_000) {
    const p = localParts(t, w.timeZone);
    const minute = (Number(p.hour) % 24) * 60 + Number(p.minute);
    if (minute >= w.startMin && minute < w.endMin) n++;
  }
  return n;
}

/** "2h 05m", or "3d 4h" from one day on. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${pad(total % 60)}m`;
}

/** "28 Oct 09:12" in the given time zone. */
export function formatLocal(t: Date, timeZone: string): string {
  const p = localParts(t.getTime(), timeZone);
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

type Who = { name: string; phone: string | null };
const who = (p: Who) => (p.phone ? `"${p.name}" (+${p.phone.replace(/^\+/, '')})` : `"${p.name}"`);

export function quietAlarmText(p: Who, since: Date, now: Date, timeZone: string): string {
  return (
    `MultiWA alert: profile ${who(p)} has received no messages since ${formatLocal(since, timeZone)} (${timeZone}), ` +
    `${formatDuration(now.getTime() - since.getTime())} ago. ` +
    'It may have lost its WhatsApp session: open the profile in the admin and reconnect.'
  );
}

export function quietRecoveredText(p: Who, alarmAt: Date, timeZone: string): string {
  return `MultiWA: profile ${who(p)} is receiving messages again. The quiet alarm was raised at ${formatLocal(alarmAt, timeZone)} (${timeZone}).`;
}

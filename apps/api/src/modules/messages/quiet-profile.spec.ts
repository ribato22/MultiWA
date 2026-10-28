// Quiet-profile alarm helpers: active silence minutes, formatting and the alarm texts.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ACTIVE_WINDOW, activeMinutesBetween, formatDuration, formatLocal, parseActiveWindow,
  quietAlarmText, quietRecoveredText, windowLabel,
} from './quiet-profile';

const W = DEFAULT_ACTIVE_WINDOW; // 07:00-22:00 Asia/Jakarta (UTC+7, no DST)
const at = (iso: string) => new Date(iso);

describe('activeMinutesBetween', () => {
  it('counts every minute inside the window on one day (10:00-12:30 WIB)', () => {
    expect(activeMinutesBetween(at('2026-10-28T03:00:00Z'), at('2026-10-28T05:30:00Z'), W)).toBe(150);
  });

  it('skips the night (21:00 WIB to 08:00 WIB next day = 60 + 60)', () => {
    expect(activeMinutesBetween(at('2026-10-27T14:00:00Z'), at('2026-10-28T01:00:00Z'), W)).toBe(120);
  });

  it('counts whole days (three local days = 3 x 900)', () => {
    expect(activeMinutesBetween(at('2026-10-24T17:00:00Z'), at('2026-10-27T17:00:00Z'), W)).toBe(2700);
  });

  it('includes the start of the window and excludes its end', () => {
    expect(activeMinutesBetween(at('2026-10-27T23:59:00Z'), at('2026-10-28T00:01:00Z'), W)).toBe(1); // 06:59, 07:00
    expect(activeMinutesBetween(at('2026-10-28T14:59:00Z'), at('2026-10-28T15:01:00Z'), W)).toBe(1); // 21:59, 22:00
  });

  it('stops at the cap', () => {
    expect(activeMinutesBetween(at('2026-10-28T03:00:00Z'), at('2026-10-28T05:30:00Z'), W, 10)).toBe(10);
  });

  it('uses the window time zone', () => {
    const utcAllDay = { startMin: 0, endMin: 24 * 60, timeZone: 'UTC' };
    expect(activeMinutesBetween(at('2026-10-28T00:00:00Z'), at('2026-10-28T01:30:00Z'), utcAllDay)).toBe(90);
  });

  it('is 0 for an empty or reversed range', () => {
    expect(activeMinutesBetween(at('2026-10-28T05:00:00Z'), at('2026-10-28T05:00:00Z'), W)).toBe(0);
    expect(activeMinutesBetween(at('2026-10-28T06:00:00Z'), at('2026-10-28T05:00:00Z'), W)).toBe(0);
  });
});

describe('parseActiveWindow', () => {
  it('reads "HH:MM-HH:MM" and a time zone', () => {
    expect(parseActiveWindow('08:30-17:00', 'UTC')).toEqual({ startMin: 510, endMin: 1020, timeZone: 'UTC' });
  });

  it('falls back to 07:00-22:00 Asia/Jakarta for missing or invalid values', () => {
    expect(parseActiveWindow(undefined, undefined)).toEqual(W);
    expect(parseActiveWindow('22:00-07:00', 'Mars/Base')).toEqual(W);
    expect(parseActiveWindow('7-22', '')).toEqual(W);
  });

  it('labels a window for the log', () => {
    expect(windowLabel(W)).toBe('07:00-22:00 Asia/Jakarta');
  });
});

describe('formatting and texts', () => {
  it('formats durations', () => {
    expect(formatDuration(125 * 60_000)).toBe('2h 05m');
    expect(formatDuration((3 * 1440 + 4 * 60) * 60_000)).toBe('3d 4h');
    expect(formatDuration(0)).toBe('0h 00m');
  });

  it('formats a local time', () => {
    expect(formatLocal(at('2026-10-28T02:12:00Z'), 'Asia/Jakarta')).toBe('28 Oct 09:12');
  });

  it('writes the alarm text', () => {
    expect(quietAlarmText({ name: 'Support', phone: '628123456789' }, at('2026-10-28T02:12:00Z'), at('2026-10-28T04:17:00Z'), 'Asia/Jakarta')).toBe(
      'MultiWA alert: profile "Support" (+628123456789) has received no messages since 28 Oct 09:12 (Asia/Jakarta), 2h 05m ago. ' +
        'It may have lost its WhatsApp session: open the profile in the admin and reconnect.',
    );
  });

  it('writes the recovery text, and leaves out a missing phone', () => {
    expect(quietRecoveredText({ name: 'Support', phone: null }, at('2026-10-28T04:17:00Z'), 'Asia/Jakarta')).toBe(
      'MultiWA: profile "Support" is receiving messages again. The quiet alarm was raised at 28 Oct 11:17 (Asia/Jakarta).',
    );
  });
});

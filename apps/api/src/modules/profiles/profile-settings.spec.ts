// The writes to a profile's settings JSON: one statement each, merging only the keys they are given, with the
// recording rule in the same statement. What they do on a real Postgres, and under a race, is pinned by
// test/call-recordings.e2e-spec.ts; here, what is sent, and the readers of the call settings.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({ prisma: { $queryRaw: vi.fn() } }));

import { prisma } from '@multiwa/database';
import {
  announcementOf, mergeProfileSettings, mergeProfileSettingsIfAnnounced, recordingOn, removeAnnouncementUnlessRecording,
  retentionDaysOf, turnRecordingOffEverywhere,
} from './profile-settings';

const db = prisma as any;
const sent = () => db.$queryRaw.mock.calls.map(([sql, ...values]: any[]) => [sql.join('?'), values]);
const MERGE = `UPDATE profiles SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END) || ?::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id = ?`;

beforeEach(() => db.$queryRaw.mockReset().mockResolvedValue([{ settings: { theme: 'dark' } }]));

describe('profile settings writes', () => {
  it('merge: the patch as JSON (a null kept as null), into what is stored now; the settings as written', async () => {
    expect(await mergeProfileSettings('p1', { callsRecording: false, quietAlarmHours: null })).toEqual({ theme: 'dark' });
    expect(sent()).toEqual([[`${MERGE} RETURNING settings`, ['{"callsRecording":false,"quietAlarmHours":null}', 'p1']]]);
  });

  it('merge only while there is an announcement: the condition is part of the statement', async () => {
    await mergeProfileSettingsIfAnnounced('p1', { callsRecording: true });
    expect(sent()).toEqual([[`${MERGE} AND jsonb_typeof(settings->'callsAnnouncement') = 'object' RETURNING settings`, ['{"callsRecording":true}', 'p1']]]);
  });

  it('the announcement is removed only while recording is off', async () => {
    await removeAnnouncementUnlessRecording('p1');
    expect(sent()).toEqual([[
      `UPDATE profiles SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings - 'callsAnnouncement' ELSE '{}'::jsonb END), "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id = ? AND coalesce(settings->>'callsRecording', 'false') <> 'true' RETURNING settings`,
      ['p1'],
    ]]);
  });

  it('a plain merge never turns recording on, nor sets an announcement that is not whole: both are programming errors', async () => {
    await expect(mergeProfileSettings('p1', { callsRecording: true })).rejects.toThrow('mergeProfileSettingsIfAnnounced');
    await expect(mergeProfileSettings('p1', { callsAnnouncement: null })).rejects.toThrow('whole announcement');
    await expect(mergeProfileSettings('p1', { callsAnnouncement: { storageKey: 'k' } })).rejects.toThrow('whole announcement');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    await mergeProfileSettings('p1', { callsRecording: false, callsAnnouncement: { storageKey: 'k', mimeType: 'audio/mpeg', durationSec: 2 } });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('null when nothing was written: no such profile, or the condition failed', async () => {
    db.$queryRaw.mockResolvedValue([]);
    expect(await mergeProfileSettings('p1', {})).toBeNull();
    expect(await mergeProfileSettingsIfAnnounced('p1', {})).toBeNull();
    expect(await removeAnnouncementUnlessRecording('p1')).toBeNull();
  });

  it('recording off everywhere: one statement, the profiles it was on for', async () => {
    db.$queryRaw.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    expect(await turnRecordingOffEverywhere()).toEqual(['p1', 'p2']);
    expect(sent()).toEqual([[
      `UPDATE profiles SET settings = settings || '{"callsRecording": false}'::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE settings->>'callsRecording' = 'true' RETURNING id`,
      [],
    ]]);
  });
});

describe('call settings readers', () => {
  const ANNOUNCEMENT = { storageKey: 'announcements/o/p/a.mp3', mimeType: 'audio/mpeg', durationSec: 4.2 };

  it('an announcement only when it is whole', () => {
    expect(announcementOf({ callsAnnouncement: { ...ANNOUNCEMENT, extra: 1 } })).toEqual(ANNOUNCEMENT);
    for (const settings of [null, undefined, 'x', {}, { callsAnnouncement: null }, { callsAnnouncement: 'k' }, { callsAnnouncement: { ...ANNOUNCEMENT, durationSec: '4' } }]) {
      expect(announcementOf(settings)).toBeNull();
    }
  });

  it('recording only when it is true itself', () => {
    expect(recordingOn({ callsRecording: true })).toBe(true);
    for (const settings of [null, {}, { callsRecording: 'true' }, { callsRecording: 1 }]) expect(recordingOn(settings)).toBe(false);
  });

  it('the retention period: a whole number of days from 1 to 3650, else 90', () => {
    expect(retentionDaysOf({ callsRecordingRetentionDays: 30 })).toBe(30);
    expect(retentionDaysOf({ callsRecordingRetentionDays: 3650 })).toBe(3650);
    for (const days of [undefined, null, 0, -5, 3651, 7.5, '30']) expect(retentionDaysOf({ callsRecordingRetentionDays: days })).toBe(90);
    expect(retentionDaysOf(null)).toBe(90);
  });
});

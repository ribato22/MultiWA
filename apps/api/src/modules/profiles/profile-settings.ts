// MultiWA Gateway - writes to a profile's settings JSON
// apps/api/src/modules/profiles/profile-settings.ts
//
// The settings JSON is written by several routes (PUT /profiles/:id, the call settings, the call announcement), and a
// route can take seconds between its read and its write (the call readiness probe, the recordings storage check). So
// none of them writes the JSON back as it read it: each merges the keys it sets, in one statement, and the keys it
// does not name stay as they are now. The recording rule sits in the same statements: recording is never on without
// an announcement, whatever runs at the same time (an UPDATE re-checks its WHERE on the row version it finally locks).
//
// A settings value that is not a JSON object (the API never writes one) counts as no settings. "updatedAt" is a Prisma
// timestamp without a time zone, which Prisma reads as UTC: now() is turned into UTC, whatever the session's zone.
import { prisma } from '@multiwa/database';

export type ProfileSettings = Record<string, unknown>;
type Written = { settings: ProfileSettings }[];

/** Merges `patch` into the profile's settings. The settings as written, or null when there is no such profile. */
export async function mergeProfileSettings(profileId: string, patch: ProfileSettings): Promise<ProfileSettings | null> {
  // The recording rule is kept by the two conditional statements below: a plain merge never turns recording on, and sets
  // an announcement only whole. mergeProfileSettingsIfAnnounced counts any object as one, so every object written here
  // must be one the readers count too.
  if (patch.callsRecording === true) throw new Error('Recording is turned on with mergeProfileSettingsIfAnnounced');
  if ('callsAnnouncement' in patch && !announcementOf(patch)) {
    throw new Error('callsAnnouncement must be a whole announcement (removeAnnouncementUnlessRecording removes it)');
  }
  const rows = await prisma.$queryRaw<Written>`UPDATE profiles SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END) || ${JSON.stringify(patch)}::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${profileId} RETURNING settings`;
  return rows[0]?.settings ?? null;
}

/** As mergeProfileSettings, only while the profile has an announcement (turning recording on). Null otherwise. */
export async function mergeProfileSettingsIfAnnounced(profileId: string, patch: ProfileSettings): Promise<ProfileSettings | null> {
  // Its condition reads the announcement already stored: one in the patch would be written without being checked.
  if ('callsAnnouncement' in patch) throw new Error('Turning recording on never sets the announcement (mergeProfileSettings does)');
  const rows = await prisma.$queryRaw<Written>`UPDATE profiles SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END) || ${JSON.stringify(patch)}::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${profileId} AND jsonb_typeof(settings->'callsAnnouncement') = 'object' RETURNING settings`;
  return rows[0]?.settings ?? null;
}

/** Removes the announcement, only while recording is off. Null when recording is on, or there is no such profile. */
export async function removeAnnouncementUnlessRecording(profileId: string): Promise<ProfileSettings | null> {
  const rows = await prisma.$queryRaw<Written>`UPDATE profiles SET settings = (CASE WHEN jsonb_typeof(settings) = 'object' THEN settings - 'callsAnnouncement' ELSE '{}'::jsonb END), "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${profileId} AND coalesce(settings->>'callsRecording', 'false') <> 'true' RETURNING settings`;
  return rows[0]?.settings ?? null;
}

/** The recordings storage turned out to be public: recording off on every profile. The profiles it was on for. */
export async function turnRecordingOffEverywhere(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`UPDATE profiles SET settings = settings || '{"callsRecording": false}'::jsonb, "updatedAt" = now() AT TIME ZONE 'UTC' WHERE settings->>'callsRecording' = 'true' RETURNING id`;
  return rows.map((r) => r.id);
}

/** The announcement callers hear before a recorded call (POST /profiles/:id/calls-announcement). */
export interface CallAnnouncement {
  storageKey: string;
  mimeType: string;
  durationSec: number;
}

export const DEFAULT_RETENTION_DAYS = 90;
export const MAX_RETENTION_DAYS = 3650;

const field = (settings: unknown, key: string): unknown =>
  settings && typeof settings === 'object' ? (settings as ProfileSettings)[key] : undefined;

export function announcementOf(settings: unknown): CallAnnouncement | null {
  const a = field(settings, 'callsAnnouncement') as Partial<CallAnnouncement> | null | undefined;
  return a && typeof a.storageKey === 'string' && typeof a.mimeType === 'string' && typeof a.durationSec === 'number' && Number.isFinite(a.durationSec)
    ? { storageKey: a.storageKey, mimeType: a.mimeType, durationSec: a.durationSec }
    : null;
}

export const recordingOn = (settings: unknown): boolean => field(settings, 'callsRecording') === true;

/** Days a recording of the profile is kept. */
export function retentionDaysOf(settings: unknown): number {
  const days = field(settings, 'callsRecordingRetentionDays');
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS ? days : DEFAULT_RETENTION_DAYS;
}

// The announcement callers hear before a recorded call: its type and length read from the file, stored under the
// profile's own key, one per profile (a replaced or removed file left to the nightly sweep), served only from the
// profile's own key, and never removed while recording is on. The rule lives in the settings write itself (mocked
// here; the e2e spec races it).
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Readable } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({ prisma: { profile: { findUnique: vi.fn() } } }));
vi.mock('../../profiles/profile-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../profiles/profile-settings')>()),
  mergeProfileSettings: vi.fn(),
  removeAnnouncementUnlessRecording: vi.fn(),
}));

import { prisma } from '@multiwa/database';
import { mergeProfileSettings, removeAnnouncementUnlessRecording } from '../../profiles/profile-settings';
import { MemoryRecordingStore } from '../../../testing/memory-recording-store';
import { CallAnnouncementService } from './call-announcement.service';

const db = prisma as any;
const merge = vi.mocked(mergeProfileSettings);
const remove = vi.mocked(removeAnnouncementUnlessRecording);
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const MP3 = readFileSync(join(__dirname, 'fixtures', 'tone.mp3'));
const OLD = `announcements/${ORG}/${PROFILE}/44444444-4444-4444-8444-444444444444.wav`;
const KEY = `announcements/${ORG}/${PROFILE}/55555555-5555-4555-8555-555555555555.mp3`;
const profileWith = (callsAnnouncement?: unknown) => ({ settings: callsAnnouncement ? { callsAnnouncement } : {}, workspace: { organizationId: ORG } });
const text = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString();
};

beforeEach(() => {
  db.profile.findUnique.mockReset().mockResolvedValue(profileWith({ storageKey: OLD, mimeType: 'audio/wav', durationSec: 5 }));
  merge.mockReset().mockResolvedValue({});
  remove.mockReset().mockResolvedValue({});
});

describe('CallAnnouncementService.upload', () => {
  // A call that has just read the previous key can still play its file: the nightly sweep deletes it, an hour old.
  it("stores the file under the profile's own key and sets it in the settings; the previous file is left to the sweep", async () => {
    const store = new MemoryRecordingStore();
    store.file(OLD);
    const del = vi.spyOn(store, 'delete');
    const out = await new CallAnnouncementService(store).upload(PROFILE, MP3);
    expect(out).toEqual({ profileId: PROFILE, announcement: { mimeType: 'audio/mpeg', durationSec: expect.any(Number) } });
    const [[profileId, patch]] = merge.mock.calls;
    const stored = (patch as any).callsAnnouncement;
    expect(profileId).toBe(PROFILE);
    expect(stored).toEqual({
      storageKey: expect.stringMatching(new RegExp(`^announcements/${ORG}/${PROFILE}/[0-9a-f-]{36}\\.mp3$`)),
      mimeType: 'audio/mpeg',
      durationSec: out.announcement.durationSec,
    });
    expect(store.files.get(stored.storageKey)?.body.equals(MP3)).toBe(true);
    expect(store.files.has(OLD)).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it('415 for what is not one of the formats: nothing stored, nothing set', async () => {
    const store = new MemoryRecordingStore();
    await expect(new CallAnnouncementService(store).upload(PROFILE, Buffer.from('not audio'))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(store.files.size).toBe(0);
    expect(merge).not.toHaveBeenCalled();
  });

  it('409 recordings_storage_unset when the storage is not configured', async () => {
    const store = new MemoryRecordingStore();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    await expect(new CallAnnouncementService(store).upload(PROFILE, MP3)).rejects.toMatchObject({ status: 409, response: { reasons: ['recordings_storage_unset'] } });
  });

  it('404 for a profile that is gone, also one deleted while the file was stored (that file left to the sweep)', async () => {
    const store = new MemoryRecordingStore();
    db.profile.findUnique.mockResolvedValueOnce(null);
    await expect(new CallAnnouncementService(store).upload(PROFILE, MP3)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.files.size).toBe(0);
    merge.mockResolvedValueOnce(null);
    await expect(new CallAnnouncementService(store).upload(PROFILE, MP3)).rejects.toBeInstanceOf(NotFoundException);
    expect([...store.files.keys()]).toEqual([expect.stringMatching(new RegExp(`^announcements/${ORG}/${PROFILE}/`))]);
  });
});

describe('CallAnnouncementService.read', () => {
  it('the audio, with its type and size', async () => {
    const store = new MemoryRecordingStore();
    store.file(KEY, 'mp3-bytes');
    db.profile.findUnique.mockResolvedValue(profileWith({ storageKey: KEY, mimeType: 'audio/mpeg', durationSec: 2 }));
    const out = await new CallAnnouncementService(store).read(PROFILE);
    expect(out).toMatchObject({ mimeType: 'audio/mpeg', size: 9 });
    expect(await text(out.body!)).toBe('mp3-bytes');
  });

  // Up to 2 MB, read only to be dropped.
  it('for a HEAD, its type and size, and nothing read', async () => {
    const store = new MemoryRecordingStore();
    store.file(KEY, 'mp3-bytes');
    const read = vi.spyOn(store, 'read');
    db.profile.findUnique.mockResolvedValue(profileWith({ storageKey: KEY, mimeType: 'audio/mpeg', durationSec: 2 }));
    expect(await new CallAnnouncementService(store).read(PROFILE, true)).toEqual({ mimeType: 'audio/mpeg', size: 9, body: null });
    expect(read).not.toHaveBeenCalled();
  });

  it("404 for none, for a missing file, and for a key that is not the profile's own", async () => {
    const store = new MemoryRecordingStore();
    const foreign = `announcements/${ORG}/${OTHER}/55555555-5555-4555-8555-555555555555.mp3`;
    store.file(foreign);
    const service = new CallAnnouncementService(store);
    db.profile.findUnique.mockResolvedValue(profileWith());
    await expect(service.read(PROFILE)).rejects.toThrow('This profile has no announcement');
    db.profile.findUnique.mockResolvedValue(profileWith({ storageKey: KEY, mimeType: 'audio/mpeg', durationSec: 2 }));
    await expect(service.read(PROFILE)).rejects.toThrow('The announcement file is missing');
    db.profile.findUnique.mockResolvedValue(profileWith({ storageKey: foreign, mimeType: 'audio/mpeg', durationSec: 2 }));
    await expect(service.read(PROFILE)).rejects.toThrow('This profile has no announcement');
  });
});

describe('CallAnnouncementService.remove', () => {
  it('removes it from the settings; its file is left to the sweep', async () => {
    const store = new MemoryRecordingStore();
    store.file(OLD);
    const del = vi.spyOn(store, 'delete');
    expect(await new CallAnnouncementService(store).remove(PROFILE)).toEqual({ profileId: PROFILE, announcement: null });
    expect(remove).toHaveBeenCalledWith(PROFILE);
    expect(store.files.has(OLD)).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it('409 recording_on while recording is on: the file is kept', async () => {
    const store = new MemoryRecordingStore();
    store.file(OLD);
    remove.mockResolvedValue(null);
    await expect(new CallAnnouncementService(store).remove(PROFILE)).rejects.toMatchObject({ status: 409, response: { reasons: ['recording_on'] } });
    expect(store.files.has(OLD)).toBe(true);
  });

  it('404 for a profile that is gone', async () => {
    db.profile.findUnique.mockResolvedValue(null);
    await expect(new CallAnnouncementService(new MemoryRecordingStore()).remove(PROFILE)).rejects.toBeInstanceOf(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
  });
});

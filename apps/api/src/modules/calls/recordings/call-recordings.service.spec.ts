// CallRecordingsService: a recording is read only through here, audited BEFORE a byte is sent (a read that cannot be
// audited is refused); deleted by an admin or by retention, the row claimed first and the file after; a deleted
// profile's files go before it; the nightly sweep deletes only the store's own, old, unreferenced objects. Prisma is
// mocked and the store is in memory; test/call-recordings.e2e-spec.ts runs the same on a real Postgres.
import type { Readable } from 'stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    callRecording: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn() },
    profile: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { InternalEvents } from '../../../metrics/internal-events';
import { MemoryRecordingStore } from '../../../testing/memory-recording-store';
import { CallRecordingsService, ORPHAN_MIN_AGE_MS } from './call-recordings.service';
import { announcementKey, recordingKey } from './recording-store';

const db = prisma as any;
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const CALL = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-31T19:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const KEY = recordingKey(ORG, PROFILE, CALL, new Date('2026-10-01T03:00:00Z'));
const ACTOR = { userId: 'u1', organizationId: ORG };
const rec = (over: Record<string, unknown> = {}) => ({
  id: 'r1', callId: CALL, profileId: PROFILE, storageType: 'local', storageKey: KEY, mimeType: 'audio/webm', bytes: 10,
  durationSec: 1, channels: 2, announcementPlayed: true, partial: false, createdAt: new Date('2026-10-01T03:01:00Z'),
  deletedAt: null, deletedByUserId: null, deleteReason: null, ...over,
});

function make(store = new MemoryRecordingStore()) {
  const audit = { log: vi.fn().mockResolvedValue({}) };
  const events = { emit: vi.fn() };
  return { service: new CallRecordingsService(store, audit as any, events as any), store, audit, events };
}

const text = async (stream: Readable | null) => {
  const chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString();
};

beforeEach(() => {
  for (const model of [db.callRecording, db.profile]) for (const fn of Object.values<any>(model)) fn.mockReset();
});

describe('CallRecordingsService.play', () => {
  const stored = () => {
    const t = make();
    t.store.file(KEY, '0123456789', NOW);
    db.callRecording.findUnique.mockResolvedValue(rec());
    return t;
  };

  it('the whole file: private, never cached, never sniffed; the play audited first', async () => {
    const { service, audit, store } = stored();
    const read = vi.spyOn(store, 'read');
    const playback = await service.play(CALL, ACTOR, undefined, false);
    expect(playback.status).toBe(200);
    expect(playback.headers).toEqual({
      'Content-Type': 'audio/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': '10',
    });
    expect(await text(playback.body)).toBe('0123456789');
    expect(db.callRecording.findUnique).toHaveBeenCalledWith({ where: { callId: CALL } });
    expect(audit.log).toHaveBeenCalledWith({
      action: 'call.recording.play', userId: 'u1', organizationId: ORG, resourceType: 'call', resourceId: CALL, metadata: { recordingId: 'r1', profileId: PROFILE },
    });
    expect(audit.log.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
  });

  it('a range: 206 with its Content-Range; a seek (not from byte 0) is not audited again', async () => {
    const { service, audit } = stored();
    const first = await service.play(CALL, ACTOR, 'bytes=0-3', false);
    expect(first).toMatchObject({ status: 206, headers: { 'Content-Range': 'bytes 0-3/10', 'Content-Length': '4' } });
    expect(await text(first.body)).toBe('0123');
    const seek = await service.play(CALL, ACTOR, 'bytes=6-', false);
    expect(seek).toMatchObject({ status: 206, headers: { 'Content-Range': 'bytes 6-9/10', 'Content-Length': '4' } });
    expect(await text(seek.body)).toBe('6789');
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('a download: an attachment, audited as a download', async () => {
    const { service, audit } = stored();
    const playback = await service.play(CALL, ACTOR, undefined, true);
    expect(playback.headers['Content-Disposition']).toBe(`attachment; filename="call-${CALL}.webm"`);
    expect(audit.log.mock.calls[0][0].action).toBe('call.recording.download');
  });

  it('416 past the end, with the size; nothing read, nothing audited', async () => {
    const { service, audit, store } = stored();
    const read = vi.spyOn(store, 'read');
    expect(await service.play(CALL, ACTOR, 'bytes=10-', false)).toMatchObject({ status: 416, headers: { 'Content-Range': 'bytes */10' }, body: null });
    expect(read).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a read that cannot be audited is refused (503), before any byte', async () => {
    const { service, audit, store } = stored();
    const read = vi.spyOn(store, 'read');
    audit.log.mockRejectedValue(new Error('db down'));
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['no recording', null],
    ['a deleted one', rec({ deletedAt: NOW, deleteReason: 'admin' })],
    ['one in another storage', rec({ storageType: 's3' })],
  ])('404 for %s, nothing audited', async (_what, row) => {
    const { service, audit } = stored();
    db.callRecording.findUnique.mockResolvedValue(row);
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('404 when its file is missing', async () => {
    const { service } = make();
    db.callRecording.findUnique.mockResolvedValue(rec());
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toThrow('The recording file is missing');
  });
});

describe('CallRecordingsService.deleteByAdmin', () => {
  it('claims the row, then deletes the file, then publishes call.recording.deleted', async () => {
    const { service, store, events } = make();
    store.file(KEY);
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    const done = await service.deleteByAdmin(CALL, 'u1');
    expect(done).toEqual({ callId: CALL, recordingId: 'r1', deletedAt: expect.any(String) });
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', deletedAt: null }, data: { deletedAt: new Date(done.deletedAt), deletedByUserId: 'u1', deleteReason: 'admin' },
    });
    expect(db.callRecording.updateMany.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]);
    expect(store.files.has(KEY)).toBe(false);
    expect(events.emit).toHaveBeenCalledWith(AppEvents.CALL.RECORDING_DELETED, {
      profileId: PROFILE, callId: CALL, recordingId: 'r1', reason: 'admin', deletedAt: done.deletedAt,
    });
  });

  it('404 when another delete came first: the file is not touched, nothing published', async () => {
    const { service, store, events } = make();
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.deleteByAdmin(CALL, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('a file that will not delete is left to the nightly sweep: the delete still succeeds', async () => {
    const { service, store } = make();
    vi.spyOn(store, 'delete').mockRejectedValue(new Error('EACCES'));
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.deleteByAdmin(CALL, 'u1')).resolves.toMatchObject({ recordingId: 'r1' });
  });

  it('404 for a call without a live recording', async () => {
    const { service } = make();
    db.callRecording.findUnique.mockResolvedValue(rec({ deletedAt: NOW }));
    await expect(service.deleteByAdmin(CALL, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.callRecording.updateMany).not.toHaveBeenCalled();
  });
});

describe('CallRecordingsService.purgeProfile', () => {
  it("deletes the profile's live recording files and its announcement; one failing does not stop the others", async () => {
    const { service, store } = make();
    const announcement = announcementKey(ORG, PROFILE, 'mp3');
    const del = vi.spyOn(store, 'delete').mockRejectedValueOnce(new Error('EACCES'));
    db.callRecording.findMany.mockResolvedValue([{ storageKey: 'a' }, { storageKey: 'b' }]);
    db.profile.findUnique.mockResolvedValue({ settings: { callsAnnouncement: { storageKey: announcement, mimeType: 'audio/mpeg', durationSec: 3 } } });
    await service.purgeProfile(PROFILE);
    expect(db.callRecording.findMany).toHaveBeenCalledWith({ where: { profileId: PROFILE, deletedAt: null }, select: { storageKey: true } });
    expect(del.mock.calls.map(([key]) => key)).toEqual(['a', 'b', announcement]);
  });

  it('does nothing when the storage is not configured', async () => {
    const store = new MemoryRecordingStore();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    await make(store).service.purgeProfile(PROFILE);
    expect(db.callRecording.findMany).not.toHaveBeenCalled();
  });
});

describe('CallRecordingsService.applyRetention', () => {
  const batch = (n: number, profileId: string) =>
    Array.from({ length: n }, (_, i) => rec({ id: `${profileId}-${i}`, callId: `${profileId}-c${i}`, profileId, storageKey: `${profileId}/${i}` }));

  it("deletes what is older than each profile's period (90 days unless set), in batches, audited as the system's", async () => {
    const { service, audit, events } = make();
    db.callRecording.groupBy.mockResolvedValue([{ profileId: 'p30' }, { profileId: 'p90' }]);
    db.profile.findMany.mockResolvedValue([
      { id: 'p30', settings: { callsRecordingRetentionDays: 30 }, workspace: { organizationId: ORG } },
      { id: 'p90', settings: {}, workspace: { organizationId: ORG } },
    ]);
    // p30: a full batch of 100, then 1 more; p90: none.
    db.callRecording.findMany.mockResolvedValueOnce(batch(100, 'p30')).mockResolvedValueOnce(batch(1, 'p30')).mockResolvedValueOnce([]);
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });

    expect(await service.applyRetention(NOW)).toBe(101);

    expect(db.callRecording.groupBy).toHaveBeenCalledWith({ by: ['profileId'], where: { deletedAt: null } });
    const before30 = new Date(NOW.getTime() - 30 * DAY);
    expect(db.callRecording.findMany.mock.calls.map(([q]: any[]) => q.where)).toEqual([
      { profileId: 'p30', deletedAt: null, createdAt: { lt: before30 } },
      { profileId: 'p30', deletedAt: null, createdAt: { lt: before30 } },
      { profileId: 'p90', deletedAt: null, createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } },
    ]);
    expect(db.callRecording.updateMany.mock.calls[0][0].data).toMatchObject({ deletedByUserId: null, deleteReason: 'retention' });
    expect(audit.log).toHaveBeenCalledTimes(101);
    expect(audit.log.mock.calls[0][0]).toEqual({
      action: 'call.recording.delete', organizationId: ORG, resourceType: 'call', resourceId: 'p30-c0',
      metadata: { recordingId: 'p30-0', profileId: 'p30', reason: 'retention', actor: 'system' },
    });
    expect(events.emit.mock.calls[0]).toEqual([AppEvents.CALL.RECORDING_DELETED, expect.objectContaining({ reason: 'retention', recordingId: 'p30-0' })]);
  });

  it('a recording another run deleted first is neither audited nor counted', async () => {
    const { service, audit } = make();
    db.callRecording.groupBy.mockResolvedValue([{ profileId: 'p1' }]);
    db.profile.findMany.mockResolvedValue([{ id: 'p1', settings: {}, workspace: { organizationId: ORG } }]);
    db.callRecording.findMany.mockResolvedValueOnce([rec()]);
    db.callRecording.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.applyRetention(NOW)).toBe(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('nothing to do without live recordings', async () => {
    db.callRecording.groupBy.mockResolvedValue([]);
    expect(await make().service.applyRetention(NOW)).toBe(0);
    expect(db.profile.findMany).not.toHaveBeenCalled();
  });
});

describe('CallRecordingsService.sweepOrphans', () => {
  it("deletes the store's own objects older than an hour that no live row or announcement points at, and nothing else", async () => {
    const { service, store } = make();
    const old = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 1000);
    const fresh = new Date(NOW.getTime() - 60_000);
    const live = recordingKey(ORG, PROFILE, CALL, NOW);
    const orphan = recordingKey(ORG, PROFILE, '44444444-4444-4444-8444-444444444444', NOW);
    const young = recordingKey(ORG, PROFILE, '55555555-5555-4555-8555-555555555555', NOW);
    const kept = announcementKey(ORG, PROFILE, 'mp3');
    const replaced = announcementKey(ORG, PROFILE, 'wav');
    for (const key of [live, orphan, kept, replaced, `${orphan}.part`, 'media/notes.txt', `probe/${CALL}`]) store.file(key, 'x', old);
    store.file(young, 'x', fresh);
    db.profile.findMany.mockResolvedValue([{ settings: { callsAnnouncement: { storageKey: kept, mimeType: 'audio/mpeg', durationSec: 2 } } }, { settings: {} }]);
    db.callRecording.findMany.mockImplementation(async ({ where }: any) => (where.storageKey.in.includes(live) ? [{ storageKey: live }] : []));

    expect(await service.sweepOrphans(NOW)).toBe(4); // the orphan, the replaced announcement, the .part, the probe
    expect([...store.files.keys()].sort()).toEqual([kept, live, 'media/notes.txt', young].sort());
    expect(db.callRecording.findMany).toHaveBeenCalledWith({ where: { storageKey: { in: expect.any(Array) }, deletedAt: null }, select: { storageKey: true } });
  });

  it('nothing when the storage is not configured', async () => {
    const store = new MemoryRecordingStore();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    expect(await make(store).service.sweepOrphans(NOW)).toBe(0);
    expect(db.profile.findMany).not.toHaveBeenCalled();
  });
});

describe('CallRecordingsService: the storage status and its privacy check', () => {
  it('counts each check by result, and keeps the last one for the status, without its detail', async () => {
    const { service, store, events } = make();
    expect(service.storageStatus()).toEqual({ storage: 'local', configured: true, problem: null, lastCheck: null });
    await service.checkStorage(NOW);
    store.privacy = { ok: false, reason: 'storage_not_private', detail: 'http://minio:9000/recs/call-recordings/probe/x is readable' };
    await service.checkStorage(NOW);
    store.privacy = { ok: false, reason: 'storage_check_failed', detail: 'timeout' };
    await service.checkStorage(NOW);
    expect(events.emit.mock.calls).toEqual([
      [InternalEvents.CALL_RECORDINGS_PRIVACY, { result: 'ok' }],
      [InternalEvents.CALL_RECORDINGS_PRIVACY, { result: 'not_private' }],
      [InternalEvents.CALL_RECORDINGS_PRIVACY, { result: 'check_failed' }],
    ]);
    expect(service.storageStatus().lastCheck).toEqual({ at: NOW.toISOString(), ok: false, reason: 'storage_check_failed' });
  });

  it('an unconfigured storage is not counted as a check', async () => {
    const store = new MemoryRecordingStore();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    store.privacy = { ok: false, reason: 'recordings_storage_unset', detail: store.problem };
    const { service, events } = make(store);
    expect(await service.checkStorage(NOW)).toMatchObject({ ok: false, reason: 'recordings_storage_unset' });
    expect(events.emit).not.toHaveBeenCalled();
    expect(service.storageStatus()).toMatchObject({ configured: false, problem: 'CALL_RECORDINGS_PATH is not set' });
  });

  it('recording needs an announcement whose file is there, then a private storage', async () => {
    const { service, store } = make();
    const announcement = { storageKey: announcementKey(ORG, PROFILE, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    expect(await service.recordingReasons({})).toEqual(['no_announcement']);
    expect(await service.recordingReasons({ callsAnnouncement: announcement })).toEqual(['no_announcement']); // its file is gone
    store.file(announcement.storageKey);
    expect(await service.recordingReasons({ callsAnnouncement: announcement })).toEqual([]);
    store.privacy = { ok: false, reason: 'storage_not_private', detail: 'x' };
    expect(await service.recordingReasons({ callsAnnouncement: announcement })).toEqual(['storage_not_private']);
  });

  it('the profiles concerned: those that record, and those with recordings stored', async () => {
    db.profile.findMany.mockResolvedValue([{ id: 'p1' }]);
    db.callRecording.groupBy.mockResolvedValue([{ profileId: 'p2' }]);
    expect(await make().service.profilesConcerned()).toEqual({ recording: ['p1'], stored: ['p2'] });
    expect(db.profile.findMany).toHaveBeenCalledWith({ where: { settings: { path: ['callsRecording'], equals: true } }, select: { id: true } });
  });
});

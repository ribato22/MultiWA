// CallRecordingsService: a recording is read only through here, audited BEFORE a byte is sent (a read that cannot be
// audited is refused); deleted by an admin or by retention, the row claimed first and the file after; a deleted
// profile's files go before it; the nightly sweep deletes only the store's own, old, unreferenced objects. Prisma is
// mocked and the store is in memory; test/call-recordings.e2e-spec.ts runs the same on a real Postgres.
import type { Readable } from 'stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

vi.mock('@multiwa/database', () => ({
  prisma: {
    callRecording: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    profile: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { InternalEvents } from '../../../metrics/internal-events';
import { MemoryRecordingStore } from '../../../testing/memory-recording-store';
import { CallRecordingsService, ORPHAN_MIN_AGE_MS, SWEEP_BATCH } from './call-recordings.service';
import { announcementKey, recordingKey } from './recording-store';

const db = prisma as any;
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const CALL = '33333333-3333-4333-8333-333333333333';
const OTHER = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-10-31T19:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const UNCONFIGURED = 'The recordings storage is not configured on this server';
const STORAGE_DOWN = 'The recordings storage did not answer; try again';
const KEY = recordingKey(ORG, PROFILE, CALL, new Date('2026-10-01T03:00:00Z'));
const ACTOR = { userId: 'u1', organizationId: ORG };
const ADMIN = { userId: 'u1', organizationId: ORG, ip: '203.0.113.7', userAgent: 'Mozilla/5.0' };
// The memory store's location is memory:test. A recording of the same type elsewhere: what a new CALL_RECORDINGS_PATH,
// bucket or prefix leaves behind.
const HERE = 'memory:test';
const OLD_DIRECTORY = 'local:/srv/old-recordings';
const ELSEWHERE = 'The recording is in another storage location than this server uses now';
const rec = (over: Record<string, unknown> = {}) => ({
  id: 'r1', callId: CALL, profileId: PROFILE, storageType: 'local', storageLocation: HERE, storageKey: KEY, mimeType: 'audio/webm', bytes: 10,
  durationSec: 1, channels: 2, announcementPlayed: true, partial: false, createdAt: new Date('2026-10-01T03:01:00Z'),
  deletedAt: null, deletedByUserId: null, deleteReason: null, ...over,
});

function make(store = new MemoryRecordingStore()) {
  const audit = { log: vi.fn().mockResolvedValue({}) };
  const events = { emit: vi.fn() };
  const service = new CallRecordingsService(store, audit as any, events as any);
  return { service, store, audit, events, warn: vi.spyOn((service as any).logger, 'warn') };
}

const unconfigured = () => {
  const store = new MemoryRecordingStore();
  store.problem = 'CALL_RECORDINGS_PATH is not set';
  store.privacy = { ok: false, reason: 'recordings_storage_unset', detail: store.problem };
  return store;
};

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

  it('a range: 206 with its Content-Range; a seek in the same play is not audited again', async () => {
    const { service, audit } = stored();
    const first = await service.play(CALL, ACTOR, 'bytes=0-3', false);
    expect(first).toMatchObject({ status: 206, headers: { 'Content-Range': 'bytes 0-3/10', 'Content-Length': '4' } });
    expect(await text(first.body)).toBe('0123');
    const seek = await service.play(CALL, ACTOR, 'bytes=6-', false);
    expect(seek).toMatchObject({ status: 206, headers: { 'Content-Range': 'bytes 6-9/10', 'Content-Length': '4' } });
    expect(await text(seek.body)).toBe('6789');
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('the audit says where the read came from', async () => {
    const { service, audit } = stored();
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7', userAgent: 'Mozilla/5.0' }, undefined, false);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', ip: '203.0.113.7', userAgent: 'Mozilla/5.0' }));
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
    expect(await service.play(CALL, ACTOR, 'bytes=10-', false)).toMatchObject({ status: 416, headers: { 'Content-Range': 'bytes */10', 'Content-Length': '0' }, body: null });
    expect(read).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  // A HEAD asks for the recording too, so it is checked, sized and audited as the GET is; but nothing is read: on S3 a
  // GetObject opened only to be dropped would have its connection aborted, not reused.
  it.each([
    ['the whole file', undefined],
    ['a range', 'bytes=2-5'],
    ['a range past the end', 'bytes=10-'],
  ])('a HEAD of %s: the answer of the GET without its body, audited as the GET is, and nothing read', async (_what, range) => {
    const { service, audit, store } = stored();
    const read = vi.spyOn(store, 'read');
    const head = await service.play(CALL, ACTOR, range, false, true);
    expect(read).not.toHaveBeenCalled();
    const fromGet = stored();
    const get = await fromGet.service.play(CALL, ACTOR, range, false);
    expect(head).toEqual({ status: get.status, headers: get.headers, body: null });
    expect(audit.log.mock.calls).toEqual(fromGet.audit.log.mock.calls);
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
    ['one in another storage type', rec({ storageType: 's3', storageLocation: 's3:recs/call-recordings/' })],
    ['one of the same type in another location', rec({ storageLocation: OLD_DIRECTORY })],
  ])('404 for %s, nothing audited', async (_what, row) => {
    const { service, audit } = stored();
    db.callRecording.findUnique.mockResolvedValue(row);
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  // One storage serves every organization of the server: its bucket or directory is not the caller's to know.
  it('the 404 for a recording elsewhere does not say where it is', async () => {
    const { service } = stored();
    db.callRecording.findUnique.mockResolvedValue(rec({ storageLocation: OLD_DIRECTORY }));
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toThrow(new NotFoundException(ELSEWHERE));
  });

  it('404 when its file is missing', async () => {
    const { service } = make();
    db.callRecording.findUnique.mockResolvedValue(rec());
    await expect(service.play(CALL, ACTOR, undefined, false)).rejects.toThrow('The recording file is missing');
  });

  it('404 when its file goes between its size and its read', async () => {
    const { service, store } = stored();
    vi.spyOn(store, 'read').mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    const missing = await service.play(CALL, ACTOR, undefined, false).catch((e) => e);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(missing.message).toBe('The recording file is missing');
  });

  // Not a bare 500: the storage is the problem, and the next try may find it answering. Its error goes to the server log
  // only: it may name the directory or the bucket's address.
  it.each(['size', 'read'] as const)('503 when the storage fails the %s, its error logged', async (method) => {
    const { service, store, warn } = stored();
    vi.spyOn(store, method).mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied\nforged'), { code: 'EACCES' }));
    const refused = await service.play(CALL, ACTOR, undefined, false).catch((e) => e);
    expect(refused).toBeInstanceOf(ServiceUnavailableException);
    expect(refused.message).toBe(STORAGE_DOWN);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`call ${CALL}`);
    expect(warn.mock.calls[0][0]).toContain('EACCES: permission deniedforged');
  });

  it('503 when the storage is not configured on this server: nothing read, nothing audited', async () => {
    const { service, store, audit } = stored();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    const read = vi.spyOn(store, 'read');
    const refused = await service.play(CALL, ACTOR, undefined, false).catch((e) => e);
    expect(refused).toBeInstanceOf(ServiceUnavailableException);
    expect(refused.message).toBe(UNCONFIGURED);
    expect(read).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});

// A player reads in ranges as it seeks, so every read is audited, once per user, address, user agent, recording and
// action every 10 minutes: auditing only the reads from byte 0 would let `bytes=1-` and the known first byte rebuild
// the file unaudited.
describe('CallRecordingsService.play: the audit window', () => {
  const stored = () => {
    const t = make();
    t.store.file(KEY, '0123456789', NOW);
    db.callRecording.findUnique.mockResolvedValue(rec());
    return t;
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('a burst of ranges by one user: one audit', async () => {
    const { service, audit } = stored();
    for (const range of ['bytes=0-3', 'bytes=4-', 'bytes=2-5', undefined]) await service.play(CALL, ACTOR, range, false);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('a read that does not start at the first byte is audited', async () => {
    const { service, audit } = stored();
    expect(await service.play(CALL, ACTOR, 'bytes=5-', false)).toMatchObject({ status: 206 });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('another user, and a download after a play, are audited each', async () => {
    const { service, audit } = stored();
    await service.play(CALL, ACTOR, 'bytes=0-3', false);
    await service.play(CALL, { userId: 'u2', organizationId: ORG }, 'bytes=0-3', false);
    await service.play(CALL, ACTOR, undefined, true);
    expect(audit.log.mock.calls.map(([e]) => `${e.userId} ${e.action}`)).toEqual(['u1 call.recording.play', 'u2 call.recording.play', 'u1 call.recording.download']);
  });

  it('audited again 10 minutes after the audited read, whatever was read in between', async () => {
    const { service, audit } = stored();
    await service.play(CALL, ACTOR, 'bytes=0-3', false);
    vi.setSystemTime(NOW.getTime() + 9 * MINUTE);
    await service.play(CALL, ACTOR, 'bytes=4-', false); // within the window: neither audited nor moving it
    expect(audit.log).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + 10 * MINUTE);
    await service.play(CALL, ACTOR, 'bytes=4-', false);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('a clock stepped back opens no window: the read after the step is audited', async () => {
    const { service, audit } = stored();
    await service.play(CALL, ACTOR, 'bytes=0-3', false);
    vi.setSystemTime(NOW.getTime() - 5 * MINUTE); // the wall clock set back (by NTP, or by hand)
    await service.play(CALL, ACTOR, 'bytes=4-', false);
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('the same user from another address is audited within the window: a second device, or a stolen token', async () => {
    const { service, audit } = stored();
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7' }, 'bytes=0-3', false);
    await service.play(CALL, { ...ACTOR, ip: '198.51.100.20' }, 'bytes=4-', false);
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7' }, 'bytes=4-', false);
    expect(audit.log.mock.calls.map(([e]) => e.ip)).toEqual(['203.0.113.7', '198.51.100.20']);
  });

  it("the same user from the same address with another user agent is audited within the window: behind a proxy, every device has the proxy's address", async () => {
    const { service, audit } = stored();
    const [desktop, phone] = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'];
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7', userAgent: desktop }, 'bytes=0-3', false);
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7', userAgent: phone }, 'bytes=4-', false);
    await service.play(CALL, { ...ACTOR, ip: '203.0.113.7', userAgent: desktop }, 'bytes=4-', false);
    expect(audit.log.mock.calls.map(([e]) => e.userAgent)).toEqual([desktop, phone]);
  });

  it('a user agent is remembered by its first 512 characters: a 16 KB header makes no 16 KB key', async () => {
    const { service, audit } = stored();
    await service.play(CALL, { ...ACTOR, userAgent: 'x'.repeat(16_000) }, undefined, false);
    expect(audit.log.mock.calls[0][0].userAgent).toHaveLength(16_000); // the audit keeps it whole
    expect([...(service as any).audited.keys()]).toEqual([JSON.stringify(['u1', '', 'x'.repeat(512), 'r1', 'call.recording.play'])]);
  });

  // Joined with a separator, an IPv6 address and a user agent holding that separator could run together the same way.
  it('two devices whose address and user agent run together alike are audited each', async () => {
    const { service, audit } = stored();
    await service.play(CALL, { ...ACTOR, ip: '2001:db8::1', userAgent: 'ab:Mozilla/5.0' }, 'bytes=0-3', false);
    await service.play(CALL, { ...ACTOR, ip: '2001:db8::1:ab', userAgent: 'Mozilla/5.0' }, 'bytes=4-', false);
    expect(audit.log.mock.calls.map(([e]) => e.ip)).toEqual(['2001:db8::1', '2001:db8::1:ab']);
  });

  it('a read whose audit failed (503) is not remembered: its retry is audited', async () => {
    const { service, audit } = stored();
    audit.log.mockRejectedValueOnce(new Error('db down'));
    await expect(service.play(CALL, ACTOR, 'bytes=0-3', false)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.play(CALL, ACTOR, 'bytes=0-3', false)).toMatchObject({ status: 206 });
    expect(audit.log).toHaveBeenCalledTimes(2);
  });

  it('at 10 000 remembered reads the oldest is forgotten, and a new read is audited all the same', async () => {
    const { service, audit } = stored();
    const audited: Map<string, number> = (service as any).audited;
    const key = (userId: string) => JSON.stringify([userId, '', '', 'r1', 'call.recording.play']);
    for (let i = 0; i < 10_000; i++) audited.set(key(`user${i}`), NOW.getTime());
    await service.play(CALL, ACTOR, undefined, false);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audited.size).toBe(10_000);
    expect(audited.has(key('user0'))).toBe(false);
    expect(audited.has(key('u1'))).toBe(true);
  });
});

describe('CallRecordingsService.deleteByAdmin', () => {
  it('claims the row, then deletes the file, then publishes call.recording.deleted', async () => {
    const { service, store, events } = make();
    store.file(KEY);
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    const done = await service.deleteByAdmin(CALL, ADMIN);
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

  // As retention's deletes are, and as a play is: resourceType call, the call's id, the recording's in the metadata.
  it('is audited after the claim and the file, with the admin, where from, and the recording', async () => {
    const { service, store, audit } = make();
    store.file(KEY);
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    await service.deleteByAdmin(CALL, ADMIN);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      action: 'call.recording.delete', userId: 'u1', organizationId: ORG, ip: '203.0.113.7', userAgent: 'Mozilla/5.0',
      resourceType: 'call', resourceId: CALL, metadata: { recordingId: 'r1', profileId: PROFILE, reason: 'admin' },
    });
    expect(del.mock.invocationCallOrder[0]).toBeLessThan(audit.log.mock.invocationCallOrder[0]);
  });

  it('an audit that cannot be written is logged, not thrown: the recording is gone by then', async () => {
    const { service, audit, warn } = make();
    audit.log.mockRejectedValueOnce(new Error('db down'));
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.deleteByAdmin(CALL, ADMIN)).resolves.toMatchObject({ recordingId: 'r1' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('404 when another delete came first: the file is not touched, nothing published or audited', async () => {
    const { service, store, events, audit } = make();
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.deleteByAdmin(CALL, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  // The row is claimed, so the recording is deleted for everyone: the admin's audit entry is written all the same.
  it('a file that will not delete is left to the nightly sweep: the delete still succeeds, audited with the admin', async () => {
    const { service, store, audit } = make();
    store.file(KEY);
    vi.spyOn(store, 'delete').mockRejectedValue(new Error('EACCES'));
    db.callRecording.findUnique.mockResolvedValue(rec());
    db.callRecording.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.deleteByAdmin(CALL, ADMIN)).resolves.toMatchObject({ recordingId: 'r1' });
    expect(store.files.has(KEY)).toBe(true);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      action: 'call.recording.delete', userId: 'u1', organizationId: ORG, ip: '203.0.113.7', userAgent: 'Mozilla/5.0',
      resourceType: 'call', resourceId: CALL, metadata: { recordingId: 'r1', profileId: PROFILE, reason: 'admin' },
    });
  });

  it('404 for a call without a live recording', async () => {
    const { service } = make();
    db.callRecording.findUnique.mockResolvedValue(rec({ deletedAt: NOW }));
    await expect(service.deleteByAdmin(CALL, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.callRecording.updateMany).not.toHaveBeenCalled();
  });

  // A row claimed for a file this server cannot reach would leave the file behind for good: no sweep here lists it.
  it('503 when the storage is not configured on this server: the row is not claimed', async () => {
    const { service } = make(unconfigured());
    db.callRecording.findUnique.mockResolvedValue(rec());
    const refused = await service.deleteByAdmin(CALL, ADMIN).catch((e) => e);
    expect(refused).toBeInstanceOf(ServiceUnavailableException);
    expect(refused.message).toBe(UNCONFIGURED);
    expect(db.callRecording.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['another storage type', rec({ storageType: 's3', storageLocation: 's3:recs/call-recordings/' })],
    ['the same type in another location', rec({ storageLocation: OLD_DIRECTORY })],
  ])('409 for a recording in %s, not saying where: the row is not claimed', async (_what, row) => {
    const { service } = make();
    db.callRecording.findUnique.mockResolvedValue(row);
    const refused = await service.deleteByAdmin(CALL, ADMIN).catch((e) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect(refused.message).toBe(`${ELSEWHERE}: it cannot be deleted from here`);
    expect(db.callRecording.updateMany).not.toHaveBeenCalled();
  });
});

describe('CallRecordingsService.purgeProfile', () => {
  const announcement = announcementKey(ORG, PROFILE, 'mp3');
  const purging = () => {
    db.callRecording.findMany.mockResolvedValue([{ storageKey: 'a', storageType: 'local', storageLocation: HERE }, { storageKey: 'b', storageType: 'local', storageLocation: HERE }]);
    db.profile.findUnique.mockResolvedValue({ settings: { callsAnnouncement: { storageKey: announcement, mimeType: 'audio/mpeg', durationSec: 3 } } });
  };

  it("deletes the profile's live recording files and its announcement", async () => {
    const { service, store } = make();
    const del = vi.spyOn(store, 'delete');
    purging();
    await service.purgeProfile(PROFILE);
    expect(db.callRecording.findMany).toHaveBeenCalledWith({ where: { profileId: PROFILE, deletedAt: null }, select: { storageKey: true, storageLocation: true } });
    expect(del.mock.calls.map(([key]) => key)).toEqual(['a', 'b', announcement]);
  });

  // Inside the DELETE request: a storage that stopped answering would hold it for one wait per file.
  it('stops at the first file that will not delete, leaving the rest to the nightly sweep; the profile is deleted all the same', async () => {
    const { service, store, warn } = make();
    const del = vi.spyOn(store, 'delete').mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ETIMEDOUT\nforged'));
    purging();
    await expect(service.purgeProfile(PROFILE)).resolves.toBeUndefined();
    expect(del.mock.calls.map(([key]) => key)).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledWith(`The recording files of profile ${PROFILE} were not all deleted (the nightly sweep will): ETIMEDOUTforged`);
  });

  it('leaves the files of the same type in another location, naming them and where for the operator: the cascade is about to drop their rows', async () => {
    const { service, store, warn } = make();
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findMany.mockResolvedValue([{ storageKey: 'a', storageType: 'local', storageLocation: HERE }, { storageKey: 'b\nforged', storageType: 'local', storageLocation: OLD_DIRECTORY }]);
    db.profile.findUnique.mockResolvedValue({ settings: {} });
    await service.purgeProfile(PROFILE);
    expect(del.mock.calls.map(([key]) => key)).toEqual(['a']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`bforged (${OLD_DIRECTORY})`);
    expect(warn.mock.calls[0][0]).not.toMatch(/[\r\n]/);
  });

  it.each([
    ["another profile's announcement", announcementKey(ORG, OTHER, 'mp3')],
    ['a recording', recordingKey(ORG, PROFILE, CALL, NOW)],
  ])("does not delete an announcement key that is not the profile's own: %s", async (_what, storageKey) => {
    const { service, store } = make();
    const del = vi.spyOn(store, 'delete');
    db.callRecording.findMany.mockResolvedValue([]);
    db.profile.findUnique.mockResolvedValue({ settings: { callsAnnouncement: { storageKey, mimeType: 'audio/mpeg', durationSec: 3 } } });
    await service.purgeProfile(PROFILE);
    expect(del).not.toHaveBeenCalled();
  });

  // The profile's rows go all the same (the cascade): the log keeps how many files were left where they are.
  it('deletes nothing when the storage is not configured, and says how many recordings of the profile it cannot reach', async () => {
    const { service, store, warn } = make(unconfigured());
    const del = vi.spyOn(store, 'delete');
    db.callRecording.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    await service.purgeProfile(PROFILE);
    expect(warn).not.toHaveBeenCalled();
    await service.purgeProfile(PROFILE);
    expect(db.callRecording.count).toHaveBeenCalledWith({ where: { profileId: PROFILE, deletedAt: null } });
    expect(db.callRecording.findMany).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([[`The call recordings storage is not configured: the purge of profile ${PROFILE} cannot reach 2 recording(s)`]]);
  });

  // The count is for the log line only: a database failing it must not stop the profile's delete.
  it('with the storage not configured, a count that fails still lets the profile go, the failure logged', async () => {
    const { service, warn } = make(unconfigured());
    db.callRecording.count.mockRejectedValueOnce(new Error('pool timeout\nforged'));
    await expect(service.purgeProfile(PROFILE)).resolves.toBeUndefined();
    expect(warn.mock.calls).toEqual([[`The call recordings storage is not configured, and the purge of profile ${PROFILE} could not count its recordings: pool timeoutforged`]]);
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

    // Only what this server's storage location holds (not merely its type): a row claimed for a file it cannot reach
    // would leave the file for good.
    expect(db.callRecording.groupBy).toHaveBeenCalledWith({ by: ['profileId'], where: { deletedAt: null, storageLocation: HERE } });
    const before30 = new Date(NOW.getTime() - 30 * DAY);
    expect(db.callRecording.findMany.mock.calls.map(([q]: any[]) => q.where)).toEqual([
      { profileId: 'p30', deletedAt: null, storageLocation: HERE, createdAt: { lt: before30 } },
      { profileId: 'p30', deletedAt: null, storageLocation: HERE, createdAt: { lt: before30 } },
      { profileId: 'p90', deletedAt: null, storageLocation: HERE, createdAt: { lt: new Date(NOW.getTime() - 90 * DAY) } },
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
    db.callRecording.count.mockResolvedValue(0);
    const { service, warn } = make();
    expect(await service.applyRetention(NOW)).toBe(0);
    expect(db.profile.findMany).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('says once how many live recordings are in another storage location (of the same type too), which it cannot delete', async () => {
    db.callRecording.groupBy.mockResolvedValue([]);
    db.callRecording.count.mockResolvedValue(3);
    const { service, warn } = make();
    expect(await service.applyRetention(NOW)).toBe(0);
    expect(db.callRecording.count).toHaveBeenCalledWith({ where: { deletedAt: null, storageLocation: { not: HERE } } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("3 live call recording(s) are in another storage location than this server's: retention cannot delete them");
  });

  it('deletes nothing when the storage is not configured, and says once how many live recordings it cannot reach', async () => {
    const { service, warn } = make(unconfigured());
    db.callRecording.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    expect(await service.applyRetention(NOW)).toBe(0);
    expect(warn).not.toHaveBeenCalled(); // an install without recordings is told nothing
    expect(await service.applyRetention(NOW)).toBe(0);
    expect(db.callRecording.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(db.callRecording.groupBy).not.toHaveBeenCalled();
    expect(db.callRecording.updateMany).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([['The call recordings storage is not configured: retention cannot reach 3 recording(s)']]);
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
    for (const key of [live, orphan, kept, replaced, `${orphan}.0a1b2c3d.part`, 'media/notes.txt', `probe/${CALL}`]) store.file(key, 'x', old);
    store.file(young, 'x', fresh);
    db.profile.findMany.mockResolvedValue([{ settings: { callsAnnouncement: { storageKey: kept, mimeType: 'audio/mpeg', durationSec: 2 } } }, { settings: {} }]);
    db.callRecording.findMany.mockImplementation(async ({ where }: any) => (where.storageKey.in.includes(live) ? [{ storageKey: live }] : []));

    expect(await service.sweepOrphans(NOW)).toBe(4); // the orphan, the replaced announcement, the .part, the probe
    expect([...store.files.keys()].sort()).toEqual([kept, live, 'media/notes.txt', young].sort());
    expect(db.callRecording.findMany).toHaveBeenCalledWith({ where: { storageKey: { in: expect.any(Array) }, deletedAt: null }, select: { storageKey: true } });
  });

  it('a file that will not delete is named in the warning, and the others are swept', async () => {
    const { service, store, warn } = make();
    const old = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 1000);
    const stuck = recordingKey(ORG, PROFILE, '44444444-4444-4444-8444-444444444444', NOW);
    store.file(stuck, 'x', old);
    store.file(recordingKey(ORG, PROFILE, '55555555-5555-4555-8555-555555555555', NOW), 'x', old);
    vi.spyOn(store, 'delete').mockRejectedValueOnce(new Error('EACCES'));
    db.profile.findMany.mockResolvedValue([]);
    db.callRecording.findMany.mockResolvedValue([]);
    expect(await service.sweepOrphans(NOW)).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(stuck));
  });

  it(`in batches of ${SWEEP_BATCH}: one orphan past a batch is in a second batch of its own, and every one is deleted`, async () => {
    const { service, store } = make();
    const old = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 1000);
    const keys = Array.from({ length: SWEEP_BATCH + 1 }, (_, i) => recordingKey(ORG, PROFILE, `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, NOW));
    for (const key of keys) store.file(key, 'x', old);
    db.profile.findMany.mockResolvedValue([]);
    db.callRecording.findMany.mockResolvedValue([]);
    expect(await service.sweepOrphans(NOW)).toBe(SWEEP_BATCH + 1);
    expect(store.files.size).toBe(0);
    expect(db.callRecording.findMany).toHaveBeenCalledTimes(2);
    expect(db.callRecording.findMany.mock.calls[0][0].where.storageKey.in).toEqual(keys.slice(0, SWEEP_BATCH));
    expect(db.callRecording.findMany.mock.calls[1][0].where.storageKey.in).toEqual([keys[SWEEP_BATCH]]);
  });

  it('nothing when the storage is not configured, saying once how many live recordings it cannot reach', async () => {
    const { service, warn } = make(unconfigured());
    db.callRecording.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    expect(await service.sweepOrphans(NOW)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(await service.sweepOrphans(NOW)).toBe(0);
    expect(db.callRecording.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    expect(db.profile.findMany).not.toHaveBeenCalled();
    expect(warn.mock.calls).toEqual([['The call recordings storage is not configured: the sweep cannot reach 2 recording(s)']]);
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

  // No check at all: an install without recordings would warn every night.
  it('an unconfigured storage is neither counted as a check nor warned about', async () => {
    const { service, events, warn } = make(unconfigured());
    expect(await service.checkStorage(NOW)).toMatchObject({ ok: false, reason: 'recordings_storage_unset' });
    expect(events.emit).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(service.storageStatus()).toMatchObject({ configured: false, problem: 'CALL_RECORDINGS_PATH is not set' });
  });

  it('recording needs an announcement of the profile whose file is there, then a private storage', async () => {
    const { service, store } = make();
    const announcement = { storageKey: announcementKey(ORG, PROFILE, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    expect(await service.recordingReasons(PROFILE, {})).toEqual(['no_announcement']);
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual(['no_announcement']); // its file is gone
    store.file(announcement.storageKey);
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual([]);
    expect(await service.recordingReasons(OTHER, { callsAnnouncement: announcement })).toEqual(['no_announcement']); // not that profile's
    store.privacy = { ok: false, reason: 'storage_not_private', detail: 'x' };
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual(['storage_not_private']);
  });

  it('an unconfigured storage is the only reason', async () => {
    const announcement = { storageKey: announcementKey(ORG, PROFILE, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    const { service } = make(unconfigured());
    expect(await service.recordingReasons(PROFILE, {})).toEqual(['recordings_storage_unset']);
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual(['recordings_storage_unset']);
  });

  // CALL_RECORDINGS_TMP missing or refused: recordings cannot be made here, but what is stored stays reachable.
  it('a store that cannot make recordings here: that is the only reason, and the status says why', async () => {
    const store = new MemoryRecordingStore();
    store.tmpProblem = 'CALL_RECORDINGS_TMP is not set';
    const { service } = make(store);
    const announcement = { storageKey: announcementKey(ORG, PROFILE, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    store.file(announcement.storageKey);
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual(['recordings_storage_unset']);
    expect(service.storageStatus()).toEqual({ storage: 'local', configured: false, problem: 'CALL_RECORDINGS_TMP is not set', lastCheck: null });
  });

  it('a storage that cannot say whether the announcement is there fails the check, and no probe is put', async () => {
    const { service, store } = make();
    const announcement = { storageKey: announcementKey(ORG, PROFILE, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    vi.spyOn(store, 'size').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const probe = vi.spyOn(store, 'checkPrivate');
    expect(await service.recordingReasons(PROFILE, { callsAnnouncement: announcement })).toEqual(['storage_check_failed']);
    expect(probe).not.toHaveBeenCalled();
  });

  it('the profiles concerned: those that record, and those with recordings stored', async () => {
    db.profile.findMany.mockResolvedValue([{ id: 'p1' }]);
    db.callRecording.groupBy.mockResolvedValue([{ profileId: 'p2' }]);
    expect(await make().service.profilesConcerned()).toEqual({ recording: ['p1'], stored: ['p2'] });
    expect(db.profile.findMany).toHaveBeenCalledWith({ where: { settings: { path: ['callsRecording'], equals: true } }, select: { id: true } });
  });
});

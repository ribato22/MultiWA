// Call recordings on a real Postgres (the unit specs only see what is sent): the settings writes keep the keys another
// write changed meanwhile, and the recording rule holds under a race; a call has one recording; retention deletes per
// profile period, keeps the rows as evidence and publishes each delete once; the orphan sweep deletes only the store's
// own, older, unreferenced files; a profile's purge takes its files; the recorder stores or discards what a crash left
// in its tmpDir. A local store in a temp dir stands in for the
// storage. Runs in the e2e suite (CI pushes the schema first); it needs no app.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { AuditService } from '../src/modules/audit/audit.service';
import { CallRecorderService } from '../src/modules/calls/recordings/call-recorder.service';
import { CallRecordingsService } from '../src/modules/calls/recordings/call-recordings.service';
import { LocalRecordingStore, announcementKey, recordingKey } from '../src/modules/calls/recordings/recording-store';
import { writeState, type RecordingState } from '../src/modules/calls/recordings/recording-tmp';
import {
  mergeProfileSettings, mergeProfileSettingsIfAnnounced, removeAnnouncementUnlessRecording, turnRecordingOffEverywhere,
} from '../src/modules/profiles/profile-settings';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe('call recordings (e2e, real Postgres)', () => {
  const tag = `rec-${Date.now()}`;
  const root = mkdtempSync(join(tmpdir(), 'multiwa-recordings-'));
  const store = new LocalRecordingStore(root);
  const events = new EventEmitter2();
  const recordings = new CallRecordingsService(store, new AuditService(), events);
  let organizationId = '';
  let workspaceId = '';
  let seq = 0;

  const makeProfile = async (settings: Parameters<typeof prisma.profile.create>[0]['data']['settings'] = {}) =>
    (await prisma.profile.create({ data: { workspaceId, displayName: `Line ${++seq}`, settings } })).id;
  /** A call answered `ageDays` ago, with its recording (and its file, unless told otherwise). */
  const recorded = async (profileId: string, ageDays: number, withFile = true) => {
    const at = new Date(Date.now() - ageDays * DAY);
    const call = await prisma.call.create({
      data: { profileId, waCallId: `${tag}-${++seq}`, fromJid: '628111000111@s.whatsapp.net', outcome: 'answered', startedAt: at },
    });
    const storageKey = recordingKey(organizationId, profileId, call.id, at);
    if (withFile) await store.put(storageKey, Buffer.from('webm'), 'audio/webm');
    return prisma.callRecording.create({
      data: { callId: call.id, profileId, storageType: 'local', storageLocation: store.location, storageKey, bytes: 4, durationSec: 1, announcementPlayed: true, createdAt: at },
    });
  };
  const fileOf = (key: string) => join(root, ...key.split('/'));
  const age = (key: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    utimesSync(fileOf(key), t, t);
  };
  const settingsOf = async (id: string) => (await prisma.profile.findUnique({ where: { id } }))!.settings as Record<string, unknown>;

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: tag, slug: tag } })).id;
    workspaceId = (await prisma.workspace.create({ data: { organizationId, name: 'W', slug: 'w' } })).id;
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } }); // cascades to its profiles, calls, recordings and audit rows
    rmSync(root, { recursive: true, force: true });
  });

  it('settings merges keep what other writes changed meanwhile, and return the settings as written', async () => {
    const id = await makeProfile({ theme: 'dark' });
    await Promise.all(Array.from({ length: 20 }, (_, i) => mergeProfileSettings(id, { [`k${i}`]: i })));
    const settings = await settingsOf(id);
    expect(settings).toMatchObject({ theme: 'dark', k0: 0, k19: 19 });
    expect(Object.keys(settings)).toHaveLength(21);
    expect(await mergeProfileSettings(id, { theme: 'light', k0: null })).toMatchObject({ theme: 'light', k0: null, k19: 19 });
    expect(await mergeProfileSettings(randomUUID(), { theme: 'x' })).toBeNull();
  });

  it('turning recording on while the announcement is removed: exactly one wins, never recording without an announcement', async () => {
    const id = await makeProfile();
    const announcement = { storageKey: announcementKey(organizationId, id, 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    for (let i = 0; i < 20; i++) {
      await mergeProfileSettings(id, { callsRecording: false, callsAnnouncement: announcement });
      const [on, removed] = await Promise.all([mergeProfileSettingsIfAnnounced(id, { callsRecording: true }), removeAnnouncementUnlessRecording(id)]);
      const settings = await settingsOf(id);
      expect(Boolean(on) !== Boolean(removed)).toBe(true);
      expect(settings.callsRecording === true).toBe(Boolean(on));
      expect('callsAnnouncement' in settings).toBe(Boolean(on));
    }
  });

  it('the rule reads the settings as they are: no recording key is off, a null announcement is none, a non-object is no settings', async () => {
    const announcement = { storageKey: announcementKey(organizationId, randomUUID(), 'mp3'), mimeType: 'audio/mpeg', durationSec: 3 };
    const plain = await makeProfile({ callsAnnouncement: announcement }); // no callsRecording key at all
    expect(await removeAnnouncementUnlessRecording(plain)).toEqual({});
    const nulled = await makeProfile({ callsAnnouncement: null });
    expect(await mergeProfileSettingsIfAnnounced(nulled, { callsRecording: true })).toBeNull();
    const scalar = await makeProfile();
    await prisma.$executeRaw`UPDATE profiles SET settings = 'null'::jsonb WHERE id = ${scalar}`;
    expect(await mergeProfileSettings(scalar, { callReplyMessage: 'Hi' })).toEqual({ callReplyMessage: 'Hi' });
    const on = await makeProfile({ callsRecording: true, callsAnnouncement: announcement });
    const off = await makeProfile({ callsRecording: false, callsAnnouncement: announcement });
    const turnedOff = await turnRecordingOffEverywhere();
    expect(turnedOff).toContain(on);
    expect(turnedOff).not.toContain(off);
    expect((await settingsOf(on)).callsRecording).toBe(false);
  });

  it('a call has one recording at most, and the recording goes with its call', async () => {
    const id = await makeProfile();
    const rec = await recorded(id, 0, false);
    await expect(
      prisma.callRecording.create({
        data: { callId: rec.callId, profileId: id, storageType: 'local', storageLocation: store.location, storageKey: `${rec.storageKey}.second`, bytes: 1, durationSec: 1, announcementPlayed: true },
      }),
    ).rejects.toThrow();
    await prisma.call.delete({ where: { id: rec.callId } });
    expect(await prisma.callRecording.findUnique({ where: { id: rec.id } })).toBeNull();
  });

  it("retention: past each profile's period, the file gone and the row kept as evidence, published and audited once each", async () => {
    const short = await makeProfile({ callsRecordingRetentionDays: 30 });
    const standard = await makeProfile(); // 90 days
    const shortOld = await recorded(short, 40);
    const shortYoung = await recorded(short, 10);
    const standardOld = await recorded(standard, 100);
    const standardYoung = await recorded(standard, 40);
    const published: Array<{ profileId: string; recordingId: string; reason: string }> = [];
    events.on(AppEvents.CALL.RECORDING_DELETED, (p) => published.push(p));
    const ours = () => published.filter((p) => p.profileId === short || p.profileId === standard);

    await recordings.applyRetention(new Date());

    const rows = new Map((await prisma.callRecording.findMany({ where: { profileId: { in: [short, standard] } } })).map((r) => [r.id, r]));
    for (const gone of [shortOld, standardOld]) {
      expect(rows.get(gone.id)).toMatchObject({ deleteReason: 'retention', deletedByUserId: null });
      expect(rows.get(gone.id)!.deletedAt).toBeInstanceOf(Date);
      expect(existsSync(fileOf(gone.storageKey))).toBe(false);
    }
    for (const kept of [shortYoung, standardYoung]) {
      expect(rows.get(kept.id)!.deletedAt).toBeNull();
      expect(existsSync(fileOf(kept.storageKey))).toBe(true);
    }
    expect(ours().map((p) => p.recordingId).sort()).toEqual([shortOld.id, standardOld.id].sort());
    expect(ours().every((p) => p.reason === 'retention')).toBe(true);
    const audits = await prisma.auditLog.findMany({ where: { organizationId, action: 'call.recording.delete' } });
    expect(audits.map((a) => (a.metadata as Record<string, unknown>).recordingId).sort()).toEqual([shortOld.id, standardOld.id].sort());

    await recordings.applyRetention(new Date());
    expect(ours()).toHaveLength(2); // what was deleted stays deleted, once
  });

  it("the orphan sweep deletes only the store's own, older, unreferenced files", async () => {
    const id = await makeProfile();
    const live = await recorded(id, 0);
    const deleted = await recorded(id, 0);
    // As if the delete of its file had failed: the row says deleted, the file is still there.
    await prisma.callRecording.update({ where: { id: deleted.id }, data: { deletedAt: new Date(), deleteReason: 'admin' } });
    const orphan = recordingKey(organizationId, id, randomUUID(), new Date());
    const young = recordingKey(organizationId, id, randomUUID(), new Date());
    const kept = announcementKey(organizationId, id, 'mp3');
    const replaced = announcementKey(organizationId, id, 'ogg');
    await mergeProfileSettings(id, { callsAnnouncement: { storageKey: kept, mimeType: 'audio/mpeg', durationSec: 3 } });
    for (const key of [orphan, young, kept, replaced, 'notes/readme.txt']) await store.put(key, Buffer.from('x'), 'application/octet-stream');
    for (const key of [live.storageKey, deleted.storageKey, orphan, kept, replaced, 'notes/readme.txt']) age(key, 2 * HOUR);
    age(young, 60_000);

    await recordings.sweepOrphans(new Date());

    for (const key of [deleted.storageKey, orphan, replaced]) expect(existsSync(fileOf(key)), key).toBe(false);
    for (const key of [live.storageKey, young, kept, 'notes/readme.txt']) expect(existsSync(fileOf(key)), key).toBe(true);
  });

  it("a profile's purge deletes its files and its announcement, nobody else's; its rows then go with the profile", async () => {
    const id = await makeProfile();
    const other = await makeProfile();
    const mine = [await recorded(id, 1), await recorded(id, 2)];
    const theirs = await recorded(other, 1);
    const announcement = announcementKey(organizationId, id, 'mp3');
    await store.put(announcement, Buffer.from('x'), 'audio/mpeg');
    await mergeProfileSettings(id, { callsAnnouncement: { storageKey: announcement, mimeType: 'audio/mpeg', durationSec: 3 } });

    await recordings.purgeProfile(id);
    await prisma.profile.delete({ where: { id } });

    for (const key of [...mine.map((r) => r.storageKey), announcement]) expect(existsSync(fileOf(key)), key).toBe(false);
    expect(existsSync(fileOf(theirs.storageKey))).toBe(true);
    expect(await prisma.callRecording.count({ where: { profileId: id } })).toBe(0);
  });

  describe('the recorder: what a crash left', () => {
    const FIXTURE = readFileSync(join(__dirname, '..', 'src', 'modules', 'calls', 'recordings', 'fixtures', 'recorded.webm'));
    const tmp = mkdtempSync(join(tmpdir(), 'multiwa-recordings-tmp-'));
    const recorder = new CallRecorderService(
      new LocalRecordingStore(root, { dir: tmp }), recordings, { recordingFailed: async () => undefined } as any, events, { emitCallUpdate: () => undefined } as any,
    );
    const ready: any[] = [];
    beforeAll(() => {
      events.on(AppEvents.CALL.RECORDING_READY, (p) => ready.push(p));
    });
    afterAll(() => rmSync(tmp, { recursive: true, force: true }));

    /** A call answered `ageDays` ago that a crash cut short: its recording in tmp (the fixture), its state as given. */
    const leftover = async (profileId: string, state: RecordingState | null, ageDays = 0) => {
      const at = new Date(Date.now() - ageDays * DAY);
      const call = await prisma.call.create({
        data: { profileId, waCallId: `${tag}-${++seq}`, fromJid: '628111000111@s.whatsapp.net', outcome: 'answered', startedAt: at },
      });
      if (state) await writeState(tmp, call.id, state);
      writeFileSync(join(tmp, `${call.id}.webm`), FIXTURE);
      for (const name of readdirSync(tmp).filter((n) => n.startsWith(call.id))) utimesSync(join(tmp, name), at, at);
      return call;
    };

    it('stores one a restart cut short, as partial, under its key with its length; discards one never announced, and one past retention', async () => {
      const profileId = await makeProfile({ callsRecordingRetentionDays: 30 });
      const cut = await leftover(profileId, { announced: true, stopped: false });
      const unannounced = await leftover(profileId, { announced: false, stopped: false });
      const expired = await leftover(profileId, { announced: true, stopped: true }, 31);
      // A leftover is uploaded only after a check found the storage private, as the boot and the nightly job run first.
      expect(await recordings.checkStorage()).toEqual({ ok: true });
      expect(await recorder.finishLeftovers()).toEqual({ stored: 1, kept: 0, discarded: 2 });
      const row = await prisma.callRecording.findUnique({ where: { callId: cut.id } });
      expect(row).toMatchObject({
        profileId, partial: true, announcementPlayed: true, storageType: 'local', storageLocation: store.location,
        storageKey: recordingKey(organizationId, profileId, cut.id, cut.startedAt), bytes: FIXTURE.length + 11, durationSec: 3, channels: 2,
      });
      expect(readFileSync(fileOf(row!.storageKey)).length).toBe(FIXTURE.length + 11);
      expect(ready).toContainEqual({ profileId, callId: cut.id, recordingId: row!.id, durationSec: 3, bytes: FIXTURE.length + 11, partial: true });
      expect(await prisma.callRecording.findMany({ where: { callId: { in: [unannounced.id, expired.id] } } })).toEqual([]);
      expect(readdirSync(tmp)).toEqual([]);
    });

    it("discards one whose call went with its profile", async () => {
      const profileId = await makeProfile();
      await leftover(profileId, { announced: true, stopped: true });
      await prisma.profile.delete({ where: { id: profileId } }); // its calls go with it
      expect(await recorder.finishLeftovers()).toEqual({ stored: 0, kept: 0, discarded: 1 });
      expect(readdirSync(tmp)).toEqual([]);
    });

    it('one stored before, whose files a crash left: its files go, and its row stays as it was', async () => {
      const profileId = await makeProfile();
      const call = await leftover(profileId, { announced: true, stopped: true });
      const before = await prisma.callRecording.create({
        data: {
          callId: call.id, profileId, storageType: 'local', storageLocation: store.location,
          storageKey: recordingKey(organizationId, profileId, call.id, call.startedAt), bytes: 1, durationSec: 1, announcementPlayed: true,
        },
      });
      await recordings.checkStorage();
      expect(await recorder.finishLeftovers()).toEqual({ stored: 1, kept: 0, discarded: 0 });
      expect(await prisma.callRecording.findUnique({ where: { callId: call.id } })).toEqual(before);
      expect(readdirSync(tmp)).toEqual([]);
    });
  });
});

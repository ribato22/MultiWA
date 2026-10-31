// MultiWA Gateway - call recordings: playback, deletion, retention
// apps/api/src/modules/calls/recordings/call-recordings.service.ts
//
// A recording is personal data. It is read only through here, by an owner or admin of the call's organization, and a
// play or a download is audited BEFORE a byte is sent: a read that cannot be audited is refused. It is deleted by an
// admin or by its profile's retention period, the row claimed first (deletedAt) and the file after, so a file whose
// delete failed is an orphan for the nightly sweep, never a recording that looks alive without its file.
import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Readable } from 'stream';
import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { AuditService } from '../../audit/audit.service';
import { InternalEvents, type CallRecordingsPrivacyPayload } from '../../../metrics/internal-events';
import { announcementOf, retentionDaysOf } from '../../profiles/profile-settings';
import { parseByteRange } from './byte-range';
import { RECORDING_STORE, isStoreKey, type PrivacyCheck, type PrivacyFailure, type RecordingStore, type StoredObject } from './recording-store';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const message = (e: unknown) => clean((e as Error)?.message ?? e);
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_BATCH = 100;
const SWEEP_BATCH = 500;
/**
 * An object younger than this may be a recording whose upload is done but whose row is not yet written (the upload
 * comes first), or an announcement whose settings are being written: the sweep leaves it for the next night.
 */
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

/** Why recording cannot be turned on for a profile now (the 409 reasons). */
export type RecordingReason = 'no_announcement' | PrivacyFailure;
export type RecordingDeleteReason = 'admin' | 'retention';

export interface Playback {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  body: Readable | null;
}

interface RecordingRef {
  id: string;
  callId: string;
  profileId: string;
  storageKey: string;
}

@Injectable()
export class CallRecordingsService {
  private readonly logger = new Logger(CallRecordingsService.name);
  private lastCheck: { at: string; ok: boolean; reason?: PrivacyFailure } | null = null;

  constructor(
    @Inject(RECORDING_STORE) private readonly store: RecordingStore,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** Where recordings go, whether that works, and the last privacy check (GET /calls/media/status). */
  storageStatus() {
    return { storage: this.store.type, configured: this.store.problem === null, problem: this.store.problem, lastCheck: this.lastCheck };
  }

  /** The privacy check of the storage (turning recording on, and nightly): counted, and kept for the status. */
  async checkStorage(at = new Date()): Promise<PrivacyCheck> {
    const check = await this.store.checkPrivate();
    this.lastCheck = check.ok ? { at: at.toISOString(), ok: true } : { at: at.toISOString(), ok: false, reason: check.reason };
    if (check.ok || check.reason !== 'recordings_storage_unset') {
      const payload: CallRecordingsPrivacyPayload = { result: check.ok ? 'ok' : check.reason === 'storage_not_private' ? 'not_private' : 'check_failed' };
      this.emit(InternalEvents.CALL_RECORDINGS_PRIVACY, payload);
    }
    if (!check.ok) this.logger.warn(`The call recordings storage check failed (${check.reason}): ${clean(check.detail)}`);
    return check;
  }

  /** Why the profile cannot record now (its announcement, then the storage); empty when it can. */
  async recordingReasons(settings: Record<string, unknown>): Promise<RecordingReason[]> {
    const reasons: RecordingReason[] = [];
    const announcement = announcementOf(settings);
    const stored = announcement && !this.store.problem ? await this.store.size(announcement.storageKey).catch(() => null) : null;
    if (stored === null) reasons.push('no_announcement');
    const check = await this.checkStorage();
    if (!check.ok) reasons.push(check.reason);
    return reasons;
  }

  /** A call's recording for playback or a download: the audit first, then the bytes (or one range of them). */
  async play(callId: string, actor: { userId: string; organizationId: string }, rangeHeader: string | undefined, download: boolean): Promise<Playback> {
    const rec = await this.liveRecording(callId);
    if (rec.storageType !== this.store.type) throw new NotFoundException(`The recording is in ${rec.storageType} storage, which this server does not use now`);
    const size = await this.store.size(rec.storageKey);
    if (size === null) throw new NotFoundException('The recording file is missing');
    const range = parseByteRange(rangeHeader, size);
    const headers: Record<string, string> = {
      'Content-Type': rec.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(download ? { 'Content-Disposition': `attachment; filename="call-${rec.callId}.webm"` } : {}),
    };
    if (range === 'unsatisfiable') return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` }, body: null };
    const { start, end } = range ?? { start: 0, end: size - 1 };
    // A player reads in ranges as it seeks: a play or a download starts at the first byte, and is audited there, once.
    if (start === 0) {
      await this.audit
        .log({
          action: download ? 'call.recording.download' : 'call.recording.play',
          userId: actor.userId,
          organizationId: actor.organizationId,
          resourceType: 'call',
          resourceId: rec.callId,
          metadata: { recordingId: rec.id, profileId: rec.profileId },
        })
        .catch((e) => {
          this.logger.warn(`The recording of call ${rec.callId} was not served: its audit failed: ${message(e)}`);
          throw new ServiceUnavailableException('The access could not be audited; try again');
        });
    }
    return {
      status: range ? 206 : 200,
      headers: { ...headers, 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) },
      body: await this.store.read(rec.storageKey, range ?? undefined),
    };
  }

  /** An admin deletes a call's recording (DELETE /calls/:id/recording; the interceptor audits it). */
  async deleteByAdmin(callId: string, userId: string) {
    const rec = await this.liveRecording(callId);
    const deletedAt = await this.remove(rec, 'admin', userId);
    if (!deletedAt) throw new NotFoundException('This call has no recording'); // deleted meanwhile
    return { callId, recordingId: rec.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Before a profile is deleted: its recording files and its announcement. Its rows go with the profile (the cascade).
   * A file whose delete fails is left to the nightly sweep, and the profile is deleted all the same.
   */
  async purgeProfile(profileId: string): Promise<void> {
    if (this.store.problem) return;
    const [rows, profile] = await Promise.all([
      prisma.callRecording.findMany({ where: { profileId, deletedAt: null }, select: { storageKey: true } }),
      prisma.profile.findUnique({ where: { id: profileId }, select: { settings: true } }),
    ]);
    const keys = rows.map((r) => r.storageKey);
    const announcement = announcementOf(profile?.settings);
    if (announcement) keys.push(announcement.storageKey);
    for (const key of keys) {
      await this.store.delete(key).catch((e) => this.logger.warn(`A recording file of profile ${clean(profileId)} was not deleted (the nightly sweep will): ${message(e)}`));
    }
  }

  /** Nightly: every recording older than its profile's retention period (callsRecordingRetentionDays, 90 days by default). */
  async applyRetention(now: Date): Promise<number> {
    const groups = await prisma.callRecording.groupBy({ by: ['profileId'], where: { deletedAt: null } });
    if (!groups.length) return 0;
    const profiles = await prisma.profile.findMany({
      where: { id: { in: groups.map((g) => g.profileId) } },
      select: { id: true, settings: true, workspace: { select: { organizationId: true } } },
    });
    let deleted = 0;
    for (const profile of profiles) {
      const before = new Date(now.getTime() - retentionDaysOf(profile.settings) * DAY_MS);
      for (;;) {
        const batch = await prisma.callRecording.findMany({
          where: { profileId: profile.id, deletedAt: null, createdAt: { lt: before } },
          orderBy: { createdAt: 'asc' },
          take: RETENTION_BATCH,
        });
        for (const rec of batch) {
          if (!(await this.remove(rec, 'retention', null))) continue;
          deleted++;
          await this.audit
            .log({
              action: 'call.recording.delete',
              organizationId: profile.workspace?.organizationId,
              resourceType: 'call',
              resourceId: rec.callId,
              metadata: { recordingId: rec.id, profileId: profile.id, reason: 'retention', actor: 'system' },
            })
            .catch((e) => this.logger.warn(`The audit of the retention of the recording of call ${rec.callId} failed: ${message(e)}`));
        }
        if (batch.length < RETENTION_BATCH) break;
      }
    }
    return deleted;
  }

  /**
   * Nightly: the store's own objects that no live recording or announcement points at, older than ORPHAN_MIN_AGE_MS:
   * a file whose delete failed, the files of a workspace or organization deleted with their rows, a replaced
   * announcement, a probe or an unfinished write left by a crash. Keys of any other shape are never touched.
   */
  async sweepOrphans(now: Date): Promise<number> {
    if (this.store.problem) return 0;
    const before = now.getTime() - ORPHAN_MIN_AGE_MS;
    const profiles = await prisma.profile.findMany({ select: { settings: true } });
    const announcements = new Set(profiles.map((p) => announcementOf(p.settings)?.storageKey).filter((k): k is string => !!k));
    let swept = 0;
    let batch: StoredObject[] = [];
    const flush = async () => {
      const live = await prisma.callRecording.findMany({ where: { storageKey: { in: batch.map((o) => o.key) }, deletedAt: null }, select: { storageKey: true } });
      const kept = new Set(live.map((r) => r.storageKey));
      for (const o of batch) {
        if (kept.has(o.key) || announcements.has(o.key)) continue;
        try {
          await this.store.delete(o.key);
          swept++;
        } catch (e) {
          this.logger.warn(`An orphaned recording file was not deleted: ${message(e)}`);
        }
      }
      batch = [];
    };
    for await (const o of this.store.list()) {
      if (!isStoreKey(o.key) || o.lastModified.getTime() > before) continue;
      batch.push(o);
      if (batch.length >= SWEEP_BATCH) await flush();
    }
    if (batch.length) await flush();
    if (swept) this.logger.log(`Swept ${swept} orphaned call recording file(s)`);
    return swept;
  }

  /** The profiles that record now, and those with recordings still stored: who a storage alert concerns. */
  async profilesConcerned(): Promise<{ recording: string[]; stored: string[] }> {
    const [recording, stored] = await Promise.all([
      prisma.profile.findMany({ where: { settings: { path: ['callsRecording'], equals: true } }, select: { id: true } }),
      prisma.callRecording.groupBy({ by: ['profileId'], where: { deletedAt: null } }),
    ]);
    return { recording: recording.map((p) => p.id), stored: stored.map((g) => g.profileId) };
  }

  private async liveRecording(callId: string) {
    const rec = await prisma.callRecording.findUnique({ where: { callId } });
    if (!rec || rec.deletedAt) throw new NotFoundException('This call has no recording');
    return rec;
  }

  /** Claims the row, then deletes the file. When the recording was deleted, or null when another delete came first. */
  private async remove(rec: RecordingRef, reason: RecordingDeleteReason, userId: string | null): Promise<Date | null> {
    const at = new Date();
    const { count } = await prisma.callRecording.updateMany({ where: { id: rec.id, deletedAt: null }, data: { deletedAt: at, deletedByUserId: userId, deleteReason: reason } });
    if (!count) return null;
    await this.store.delete(rec.storageKey).catch((e) => this.logger.warn(`The file of the recording of call ${rec.callId} was not deleted (the nightly sweep will): ${message(e)}`));
    this.emit(AppEvents.CALL.RECORDING_DELETED, { profileId: rec.profileId, callId: rec.callId, recordingId: rec.id, reason, deletedAt: at.toISOString() });
    return at;
  }

  private emit(event: string, payload: unknown): void {
    try {
      this.events.emit(event, payload);
    } catch (e) {
      this.logger.warn(`The event ${event} failed: ${message(e)}`);
    }
  }
}

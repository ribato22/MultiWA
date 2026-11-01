// MultiWA Gateway - the recorder of calls answered in the dashboard
// apps/api/src/modules/calls/recordings/call-recorder.service.ts
//
// A call on a profile with recording on is recorded in the profile's WhatsApp Web page (left: the caller, right: what
// the caller hears) from before the announcement, so the file itself shows the caller heard it. Only then is the agent
// connected. The chunks go to a file in the store's tmpDir as they come, next to a state file a crash leaves behind.
// When the call ends, the recording gets its length written in, is stored (four tries), gets its call_recordings row,
// and call.recording.ready goes out.
//
// A recorder that does not start, or an announcement that does not play, leaves the call unrecorded: the agent is
// connected all the same, the files are deleted, and the admins are alerted. A recording whose announcement did not
// play is never kept. One that could not be stored stays in tmpDir and is tried again at boot and each night, never to
// a storage last found public, and never past its profile's retention period.
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { once } from 'events';
import { createWriteStream, type WriteStream } from 'fs';
import { rm, stat } from 'fs/promises';
import { finished } from 'stream/promises';
import { prisma } from '@multiwa/database';
import { AppEvents, REALTIME_EMITTER, type RealtimeEmitter } from '@multiwa/core';
import { toCallPayload, withTimeout } from '@multiwa/engine-runtime';
import type { CallMediaEngine } from '@multiwa/engines';
import { InternalEvents, type CallRecorderPayload } from '../../../metrics/internal-events';
import { announcementOf, recordingOn, retentionDaysOf, type CallAnnouncement } from '../../profiles/profile-settings';
import { CallAlerts, type RecordingFailure } from '../coordinator/call-alerts';
import { ANNOUNCEMENT_LIMIT_SECONDS, ANNOUNCEMENT_MAX_BYTES } from './announcement-audio';
import { CallRecordingsService } from './call-recordings.service';
import { RECORDING_STORE, isAnnouncementOf, recordingKey, type RecordingStore } from './recording-store';
import { leftovers, readState, removeFiles, tmpFiles, writeState } from './recording-tmp';
import { finalizeWebm } from './webm-duration';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
const message = (e: unknown) => clean((e as Error)?.message ?? e);
const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = 8_000; // the page waits up to 5 s for the caller's audio
const ANNOUNCEMENT_LIMIT_MS = ANNOUNCEMENT_LIMIT_SECONDS * 1000;
// The page refuses what decodes longer than the limit, and cuts one off 5 s past its own length.
const ANNOUNCE_MS = ANNOUNCEMENT_LIMIT_MS + 8_000;
const STOP_MS = 10_000; // the last chunk comes with the stop, and the agent's Hang up waits for it
// The waits between an upload's four tries: well inside the hour the orphan sweep leaves a new file alone.
const RETRY_AFTER_MS = [2_000, 8_000, 30_000];

/** What a call on a profile is recorded with; null: it is not recorded. */
export interface RecordingPlan {
  announcement: CallAnnouncement;
}

/** A call to record: what the coordinator's session knows of it. */
export interface RecordedCall {
  /** The calls row id (a lowercase uuid): it names the files and the stored key. */
  callId: string;
  waCallId: string;
  profileId: string;
  organizationId: string;
  startedAt: Date;
  media: CallMediaEngine;
  announcement: CallAnnouncement;
  /** Whether the call goes on: a step after its end is not taken, and a failure then is no failure. */
  live: () => boolean;
  /** Just before the announcement plays, with its length: the agent hears the caller meanwhile, not the announcement. */
  onAnnouncing: (durationSec: number) => void;
}

/** What keeping a recording needs of its call. */
interface CallFacts {
  profileId: string;
  organizationId: string;
  startedAt: Date;
}

interface Run {
  call: RecordedCall;
  /** `record` itself: the end waits for it, so that what it learned is known. */
  begun: Promise<void>;
  /** The state's writes, one after another: each writes what is known when it runs. */
  saving: Promise<void>;
  out: WriteStream | null;
  /** The engine's recorder may hold this call: a start was asked for, and no stop since. */
  recording: boolean;
  announced: boolean;
  stopped: boolean;
  /** A write to the file failed (a full disk): what is in it is all there is. */
  broken: boolean;
  /** The end began. */
  ending: boolean;
  /** The file is closed: a chunk after that belongs to no recording here. */
  closed: boolean;
}

export type KeepResult = 'stored' | 'kept' | 'discarded';

@Injectable()
export class CallRecorderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CallRecorderService.name);
  private readonly runs = new Map<string, Run>();
  /** Recordings being stored (a run's end, the boot, the nightly job): never two at once for one call. */
  private readonly keeping = new Map<string, Promise<unknown>>();
  /** The waits between an upload's tries (a spec makes them short). */
  retryAfterMs = RETRY_AFTER_MS;

  constructor(
    @Inject(RECORDING_STORE) private readonly store: RecordingStore,
    private readonly recordings: CallRecordingsService,
    private readonly alerts: CallAlerts,
    private readonly events: EventEmitter2,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
  ) {}

  /**
   * Whether a call on this profile is recorded, and with which announcement: recording on, the profile's own
   * announcement, and a storage set up. No privacy check per call: that runs when recording is turned on, and nightly.
   */
  plan(profileId: string, settings: unknown): RecordingPlan | null {
    if (this.store.problem || this.store.tmpProblem || !this.store.tmpDir || !recordingOn(settings)) return null;
    const announcement = announcementOf(settings);
    return announcement && isAnnouncementOf(announcement.storageKey, profileId) ? { announcement } : null;
  }

  /**
   * Records the call, then plays its announcement. Resolves when the agent may be connected: after the announcement,
   * or as soon as either failed (the call then goes on unrecorded). Never throws.
   */
  async begin(call: RecordedCall): Promise<void> {
    const run: Run = {
      call, begun: Promise.resolve(), saving: Promise.resolve(), out: null,
      recording: false, announced: false, stopped: false, broken: false, ending: false, closed: false,
    };
    this.runs.set(call.callId, run);
    run.begun = this.record(run);
    await run.begun;
  }

  /**
   * The call ended: stops its recorder (the last chunks come with the stop), then keeps the recording in the
   * background. Never throws, and never waits for the storage: the agent's Hang up waits for this.
   */
  async end(callId: string): Promise<void> {
    const run = this.runs.get(callId);
    if (!run || run.ending) return;
    run.ending = true;
    run.stopped = await this.stopEngine(run);
    void this.track(callId, this.finish(run));
  }

  /**
   * What a crash or a failed upload left in tmpDir, for calls no run here holds: discarded when its announcement had
   * not played, when its call is gone, or once older than its profile's retention period (logged); stored otherwise,
   * in one try, partial unless its recorder was stopped cleanly. At boot and each night.
   */
  async finishLeftovers(now = new Date()): Promise<Record<KeepResult, number>> {
    const counts: Record<KeepResult, number> = { stored: 0, kept: 0, discarded: 0 };
    if (this.store.problem || !this.store.tmpDir) return counts;
    for (const { callId, modifiedAt } of await leftovers(this.store.tmpDir)) {
      if (this.runs.has(callId) || this.keeping.has(callId)) continue;
      const result = await this.track(callId, this.leftover(callId, modifiedAt, now));
      if (result) counts[result]++;
    }
    if (counts.stored || counts.kept || counts.discarded) {
      this.logger.log(`Unfinished call recordings: ${counts.stored} stored, ${counts.kept} kept for the next try, ${counts.discarded} discarded`);
    }
    return counts;
  }

  /** At boot: what the previous process left (calls a crash or a restart cut short). Not awaited: the API starts at once. */
  onApplicationBootstrap(): void {
    void this.finishLeftovers().catch((e) => this.logger.warn(`The unfinished call recordings were not finished at boot: ${message(e)}`));
  }

  private async record(run: Run): Promise<void> {
    const { call } = run;
    let failure: RecordingFailure = 'recorder_failed';
    try {
      // The state first: a recording file is never without one, whatever stops this process.
      await this.save(run);
      run.out = createWriteStream(tmpFiles(this.store.tmpDir, call.callId).recording, { flags: 'a', mode: 0o600 });
      run.out.on('error', (e) => {
        run.broken = true;
        this.logger.warn(`Call ${clean(call.callId)}: its recording could not be written on: ${message(e)}`);
      });
      await once(run.out, 'open'); // a file that cannot be opened fails here, before the recorder starts
      if (!call.live()) return await this.drop(run, null);
      run.recording = true;
      await withTimeout(call.media.startRecording(call.waCallId, (chunk) => this.chunk(run, chunk)), START_MS, 'the recorder did not start in time');
      failure = 'announcement_failed';
      if (!call.live()) return await this.drop(run, null);
      const audio = await this.announcementBytes(call.announcement.storageKey);
      if (!call.live()) return await this.drop(run, null);
      call.onAnnouncing(call.announcement.durationSec);
      await withTimeout(
        call.media.playAnnouncement(call.waCallId, audio, { maxDurationMs: ANNOUNCEMENT_LIMIT_MS }),
        ANNOUNCE_MS,
        'the announcement did not finish in time',
      );
      run.announced = true;
      await this.save(run);
    } catch (e) {
      // A call that ended meanwhile failed nothing: it is simply not recorded.
      await this.drop(run, call.live() ? { failure, error: e } : null);
    }
  }

  /** The engine's rule: onChunk never throws. A chunk after the file closed belongs to no recording here. */
  private chunk(run: Run, chunk: Buffer): void {
    if (run.closed || !run.out) return;
    run.out.write(chunk);
  }

  /** The announcement's bytes, at most what an upload may be: a larger file is not the one uploaded. */
  private async announcementBytes(key: string): Promise<Buffer> {
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of await this.store.read(key)) {
      size += (part as Buffer).length;
      if (size > ANNOUNCEMENT_MAX_BYTES) throw new Error('the announcement file is larger than an upload may be');
      parts.push(part as Buffer);
    }
    return Buffer.concat(parts);
  }

  /** Writes what is known of the run's recording; the writes queue, so the last one has the latest. */
  private save(run: Run): Promise<void> {
    run.saving = run.saving
      .then(() => writeState(this.store.tmpDir, run.call.callId, { announced: run.announced, stopped: run.stopped }))
      .catch((e) => this.logger.warn(`Call ${clean(run.call.callId)}: its recording's state was not written: ${message(e)}`));
    return run.saving;
  }

  /** Stops the engine's recorder of this run, once: true when the stop gave every chunk (a rejection: partial). */
  private async stopEngine(run: Run, quiet = false): Promise<boolean> {
    if (!run.recording) return false;
    run.recording = false;
    try {
      await withTimeout(run.call.media.stopRecording(run.call.waCallId), STOP_MS, 'the recorder did not stop in time');
      return true;
    } catch (e) {
      if (!quiet) this.logger.warn(`Call ${clean(run.call.callId)}: its recorder did not stop cleanly, so its recording may be partial: ${message(e)}`);
      return false;
    }
  }

  private async close(run: Run): Promise<void> {
    run.closed = true;
    if (!run.out) return;
    run.out.end();
    await finished(run.out).catch(() => undefined); // its error was logged
  }

  /** The recording is not kept: its recorder stopped, its files deleted. `failed`: why, when the call goes on. */
  private async drop(run: Run, failed: { failure: RecordingFailure; error: unknown } | null): Promise<void> {
    const { call } = run;
    await this.stopEngine(run, true);
    await this.close(run);
    await run.saving;
    this.runs.delete(call.callId);
    await removeFiles(this.store.tmpDir, call.callId).catch((e) => this.logger.warn(`Call ${clean(call.callId)}: its recording's files were not deleted: ${message(e)}`));
    if (!failed) return;
    const what = failed.failure === 'recorder_failed' ? 'the recorder did not start' : 'the announcement did not play';
    this.logger.warn(`Call ${clean(call.callId)} of profile ${clean(call.profileId)} goes on unrecorded: ${what}: ${message(failed.error)}`);
    this.counter({ kind: 'failed', stage: failed.failure === 'recorder_failed' ? 'start' : 'announcement' });
    void this.alerts.recordingFailed(failed.failure, call.profileId).catch((e) => this.logger.warn(`The recording alert for ${clean(call.profileId)} failed: ${message(e)}`));
  }

  /** After the end: once `record` is done, the state saved and the file closed, the recording is kept. */
  private async finish(run: Run): Promise<KeepResult> {
    const { call } = run;
    await run.begun;
    if (this.runs.get(call.callId) !== run) return 'discarded'; // dropped: nothing to keep
    await this.save(run);
    await this.close(run);
    this.runs.delete(call.callId);
    if (!run.announced) {
      await removeFiles(this.store.tmpDir, call.callId);
      return 'discarded';
    }
    return this.keep(call.callId, call, !run.stopped || run.broken, this.retryAfterMs);
  }

  private async leftover(callId: string, modifiedAt: Date, now: Date): Promise<KeepResult> {
    const dir = this.store.tmpDir;
    const discard = async (why: string): Promise<KeepResult> => {
      this.logger.warn(`An unfinished recording of call ${clean(callId)} is discarded: ${why}`);
      await removeFiles(dir, callId);
      return 'discarded';
    };
    const state = await readState(dir, callId);
    if (!state?.announced) return discard('its announcement had not played');
    if (!(await stat(tmpFiles(dir, callId).recording).then(() => true, () => false))) return discard('its recording file is missing');
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { profileId: true, startedAt: true, profile: { select: { settings: true, workspace: { select: { organizationId: true } } } } },
    });
    const organizationId = call?.profile?.workspace?.organizationId;
    if (!call || !organizationId) return discard('its call is gone');
    if (now.getTime() - modifiedAt.getTime() > retentionDaysOf(call.profile.settings) * DAY_MS) {
      return discard("it is older than its profile's retention period");
    }
    return this.keep(callId, { profileId: call.profileId, organizationId, startedAt: call.startedAt }, !state.stopped, []);
  }

  /**
   * Stores the recording in tmpDir: its length written in, put (a first try, then one after each of `waits`), its
   * row, then its files go and call.recording.ready goes out. 'kept': not stored now; its files stay for the next try.
   */
  private async keep(callId: string, call: CallFacts, partial: boolean, waits: number[]): Promise<KeepResult> {
    const dir = this.store.tmpDir;
    const files = tmpFiles(dir, callId);
    if (this.recordings.storageStatus().lastCheck?.reason === 'storage_not_private') {
      this.logger.warn(`The recording of call ${clean(callId)} is kept on this server: the recordings storage was last found readable without a login`);
      return 'kept';
    }
    const key = recordingKey(call.organizationId, call.profileId, callId, call.startedAt);
    try {
      const webm = await finalizeWebm(files.recording, files.final);
      if (!webm.rewritten) this.logger.warn(`The recording of call ${clean(callId)} is stored without its length: it is not laid out as a browser records`);
      if (!(await this.put(key, files.final, waits))) {
        this.counter({ kind: 'upload', result: 'failed' });
        void this.alerts.recordingFailed('upload_failed', call.profileId).catch((e) => this.logger.warn(`The recording alert for ${clean(call.profileId)} failed: ${message(e)}`));
        return 'kept';
      }
      let row: { id: string; callId: string; durationSec: number; bytes: number; partial: boolean };
      try {
        row = await prisma.callRecording.create({
          data: {
            callId, profileId: call.profileId, storageType: this.store.type, storageLocation: this.store.location, storageKey: key,
            mimeType: 'audio/webm', bytes: webm.bytes, durationSec: Math.round(webm.durationMs / 1000), channels: 2, announcementPlayed: true, partial,
          },
        });
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'P2003') {
          // Its call is gone (its profile was deleted meanwhile): there is nothing to keep it for.
          await this.store.delete(key).catch(() => undefined);
          await removeFiles(dir, callId);
          return 'discarded';
        }
        if (code !== 'P2002') throw e;
        await removeFiles(dir, callId); // stored already, by an earlier try whose files were not deleted
        return 'stored';
      }
      await removeFiles(dir, callId);
      this.counter({ kind: 'upload', result: 'ok' });
      this.ready(row, call.profileId);
      return 'stored';
    } catch (e) {
      this.logger.warn(`The recording of call ${clean(callId)} was not stored; it is kept on this server for the next try: ${message(e)}`);
      return 'kept';
    } finally {
      await rm(files.final, { force: true }).catch(() => undefined);
    }
  }

  private async put(key: string, path: string, waits: number[]): Promise<boolean> {
    for (let i = 0; ; i++) {
      try {
        await this.store.putFile(key, path, 'audio/webm');
        return true;
      } catch (e) {
        this.logger.warn(`A call recording was not stored (try ${i + 1} of ${waits.length + 1}): ${message(e)}`);
        if (i >= waits.length) return false;
        await new Promise((resolve) => setTimeout(resolve, waits[i]));
      }
    }
  }

  /** call.recording.ready (the ids and facts, never a key or an address), and the call's call:update. */
  private ready(row: { id: string; callId: string; durationSec: number; bytes: number; partial: boolean }, profileId: string): void {
    try {
      this.events.emit(AppEvents.CALL.RECORDING_READY, { profileId, callId: row.callId, recordingId: row.id, durationSec: row.durationSec, bytes: row.bytes, partial: row.partial });
    } catch (e) {
      this.logger.warn(`call.recording.ready of call ${clean(row.callId)} failed: ${message(e)}`);
    }
    void prisma.call
      .findUnique({ where: { id: row.callId } })
      .then((found) => {
        if (found) this.realtime.emitCallUpdate(profileId, { ...toCallPayload(found), hasRecording: true });
      })
      .catch((e) => this.logger.warn(`The call:update of call ${clean(row.callId)} failed: ${message(e)}`));
  }

  /** The counters; they never stop a recording. */
  private counter(payload: CallRecorderPayload): void {
    try {
      this.events.emit(InternalEvents.CALL_RECORDER, payload);
    } catch {
      // a metrics listener's failure is its own
    }
  }

  /** `work` as the call's one storing in flight; a failure is logged. */
  private track<T>(callId: string, work: Promise<T>): Promise<T | undefined> {
    const tracked = work
      .catch((e): undefined => {
        this.logger.warn(`The recording of call ${clean(callId)} was not finished: ${message(e)}`);
        return undefined;
      })
      .finally(() => this.keeping.delete(callId));
    this.keeping.set(callId, tracked);
    return tracked;
  }
}

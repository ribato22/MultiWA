// MultiWA Gateway - the nightly job of the call recordings, and the reaction to a public storage
// apps/api/src/modules/calls/recordings/call-recordings.cron.ts
//
// At 02:30 server time (the process's TZ): the storage's privacy check, then the recordings a crash or a failed upload
// left, then retention, then the orphan sweep. Each step on its own, so one failing does not skip the others; every
// step is idempotent, so a second api process doing the same is harmless for the data, though each process sends its
// own alerts. Any check that finds the storage public, this job's or an admin's turning recording on, turns recording
// off on every profile and alerts the admins: the probe's own bytes came back without credentials, so it is never a
// fluke.
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { InternalEvents, type CallRecordingsPrivacyPayload } from '../../../metrics/internal-events';
import { turnRecordingOffEverywhere } from '../../profiles/profile-settings';
import { CallAlerts } from '../coordinator/call-alerts';
import { CallRecordingsService } from './call-recordings.service';
import { CallRecorderService } from './call-recorder.service';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
// A storage still public with nothing left to turn off (recordings stored on it) is alerted again at most this often,
// so the nightly check reminds the admins every day, and a burst of checks does not flood them.
const PUBLIC_ALERT_EVERY_MS = 20 * 60 * 60 * 1000;

@Injectable()
export class CallRecordingsCron {
  private readonly logger = new Logger(CallRecordingsCron.name);
  private lastPublicAlertAt = -Infinity;

  constructor(
    private readonly recordings: CallRecordingsService,
    private readonly alerts: CallAlerts,
    private readonly recorder: CallRecorderService,
  ) {}

  // The cron library calls the job with its onComplete as the first argument, so the clock is taken here.
  @Cron('30 2 * * *')
  nightly(): Promise<void> {
    return this.run(new Date());
  }

  async run(now: Date): Promise<void> {
    await this.step('privacy check', () => this.checkPrivacy(now));
    // After the check: a recording is never stored to a storage it found public. Before the sweep: stored now, a
    // recording is no orphan.
    await this.step('unfinished recordings', () => this.recorder.finishLeftovers(now));
    await this.step('retention', async () => {
      const deleted = await this.recordings.applyRetention(now);
      if (deleted) this.logger.log(`Retention deleted ${deleted} call recording(s)`);
    });
    await this.step('orphan sweep', () => this.recordings.sweepOrphans(now));
  }

  /** Every privacy check's result (CallRecordingsService.checkStorage): a public storage is reacted to here. */
  @OnEvent(InternalEvents.CALL_RECORDINGS_PRIVACY)
  async onPrivacyCheck(payload: CallRecordingsPrivacyPayload): Promise<void> {
    if (payload?.result !== 'not_private') return;
    try {
      const turnedOff = await turnRecordingOffEverywhere();
      // Before the alert: should it fail, the next check turns nothing off, and only this line says which profiles
      // lost recording.
      if (turnedOff.length) {
        this.logger.warn(`The call recordings storage serves its files without credentials: recording was turned off for ${clean(turnedOff.join(', '))}`);
      }
      const now = Date.now();
      if (!turnedOff.length && now - this.lastPublicAlertAt < PUBLIC_ALERT_EVERY_MS) return;
      const previous = this.lastPublicAlertAt;
      this.lastPublicAlertAt = now;
      let told = false;
      try {
        const { stored } = await this.recordings.profilesConcerned();
        told = await this.alerts.recordingStorage('not_private', [...new Set([...turnedOff, ...stored])], turnedOff);
      } finally {
        // An alert that failed, or reached nobody (every bell failed), starts no window, so the next check alerts. Only
        // if the mark is still this one's: a check that alerted meanwhile keeps its window.
        if (!told && this.lastPublicAlertAt === now) this.lastPublicAlertAt = previous;
      }
    } catch (e) {
      this.logger.error(`The reaction to a public call recordings storage failed: ${clean((e as Error)?.message ?? e)}`);
    }
  }

  // A public storage is handled by onPrivacyCheck, which this check's own event reaches.
  private async checkPrivacy(now: Date): Promise<void> {
    const check = await this.recordings.checkStorage(now);
    if (check.ok || check.reason !== 'storage_check_failed') return;
    const { recording } = await this.recordings.profilesConcerned();
    await this.alerts.recordingStorage('check_failed', recording, []);
  }

  private async step(name: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.logger.error(`The nightly ${name} of the call recordings failed: ${clean((e as Error)?.message ?? e)}`);
    }
  }
}

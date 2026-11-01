// MultiWA Gateway - the call coordinator's alerts
// apps/api/src/modules/calls/coordinator/call-alerts.ts
//
// The media server's worker died: every call it carried lost its audio and was ended. Through the quiet-profile
// alarm's channel: the bell for every user of each organization that answers calls in the dashboard, told only of its
// own calls, and WhatsApp to the alarm numbers (quietAlarmNotify) of the profiles whose calls were cut, through
// another connected profile.
// And the recordings storage failing its privacy check: the same channel, per organization, the bell for its owner and
// admins only.
// And a call whose recording failed (the recorder did not start, the announcement did not play, or it could not be
// stored): per profile, the bell for its organization's owners and admins only.
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { NotificationsService, NotificationType } from '../../notifications/notifications.service';
import { MessagesService } from '../../messages/messages.service';
import { sendOpsAlert } from '../../messages/ops-alert';
import { parseActiveWindow } from '../../messages/quiet-profile';

const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
// A worker in a crash loop is restarted within 30 s of each death (the backoff's cap): an organization whose calls a
// death did not cut gets its bell at most this often.
const NO_CUT_BELL_MS = 10 * 60 * 1000;
// A recorder that is broken fails every call of its profile: one alert an hour (per kind) says it.
const RECORDING_ALERT_EVERY_MS = 60 * 60 * 1000;

/** Why a call's recording failed. */
export type RecordingFailure = 'recorder_failed' | 'announcement_failed' | 'upload_failed';

@Injectable()
export class CallAlerts {
  private readonly logger = new Logger(CallAlerts.name);
  // The quiet-profile alarm's time zone, so that both alerts read the same clock.
  private readonly timeZone = parseActiveWindow(process.env.QUIET_ALARM_ACTIVE_HOURS, process.env.QUIET_ALARM_TIMEZONE).timeZone;
  // Each organization's last bell that was sent, on the deaths' own clock (`at`): a bell lost to a database outage
  // starts no quiet window.
  private readonly lastBellAt = new Map<string, number>();
  // Each profile's and kind's last recording bell that was sent: a bell lost to a database outage starts no hour.
  private readonly lastRecordingAlertAt = new Map<string, number>();

  constructor(
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => MessagesService)) private readonly messages: MessagesService,
  ) {}

  /** `cutProfileIds`: one profile id per call that was cut. */
  async workerDied(cutProfileIds: string[], at: Date): Promise<void> {
    const profiles = await prisma.profile.findMany({
      where: { OR: [{ settings: { path: ['callsAnswerInDashboard'], equals: true } }, { id: { in: cutProfileIds } }] },
      select: { id: true, displayName: true, phoneNumber: true, settings: true, workspace: { select: { organizationId: true } } },
    });
    const orgOf = new Map(profiles.map((p) => [p.id, p.workspace?.organizationId]));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: this.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    const stopped = `server that carries the audio of calls answered in the dashboard stopped at ${time} (${this.timeZone}) and is restarting.`;
    const orgs = new Set(profiles.map((p) => p.workspace?.organizationId).filter((o): o is string => !!o));
    for (const orgId of orgs) {
      const cut = cutProfileIds.filter((id) => orgOf.get(id) === orgId).length;
      if (!cut && at.getTime() - (this.lastBellAt.get(orgId) ?? -Infinity) < NO_CUT_BELL_MS) continue;
      const title = cut ? `Call audio server restarting: ${cut} call(s) cut off` : 'Call audio server restarting';
      const text = `The ${stopped}` + (cut ? ` ${cut} call(s) lost their audio and were ended.` : ' No call was in progress.');
      try {
        await this.notifications.createForOrg(orgId, NotificationType.SYSTEM, title, text, { kind: 'calls_media_worker_died', calls: cut });
        this.lastBellAt.set(orgId, at.getTime());
      } catch (e) {
        this.logger.warn(`Call media bell for ${orgId} failed: ${clean((e as Error)?.message ?? e)}`);
      }
    }
    for (const p of profiles) {
      const orgId = p.workspace?.organizationId;
      if (!orgId || !cutProfileIds.includes(p.id)) continue;
      try {
        await sendOpsAlert(this.messages, this.logger, {
          what: `Call media alert for ${p.id}`,
          organizationId: orgId,
          excludeProfileId: p.id,
          ownPhone: p.phoneNumber,
          recipients: (p.settings as Record<string, unknown> | null)?.quietAlarmNotify,
          text: `⚠️ ${p.displayName || p.id}: the ${stopped} This profile's call lost its audio and was ended.`,
        });
      } catch (e) {
        this.logger.warn(`Call media alert for ${p.id} failed: ${clean((e as Error)?.message ?? e)}`);
      }
    }
  }

  /**
   * A privacy check of the recordings storage failed. `not_private` (any check): anyone can read the recordings, and
   * recording was turned off for `turnedOff`. `check_failed` (the nightly check): the check proved nothing, and recording
   * stays on. One bell per organization concerned, for its owners and admins: they are the ones who can act on it
   * (recording is theirs to turn on again). And WhatsApp to the alarm numbers of its profiles concerned, which any user
   * who may edit a profile can set: so the text, like the bell, names no address of the storage (the server log has
   * it). The storage serves every organization of the server, so only whoever runs the server can fix it.
   *
   * Each failure is only logged, so it resolves all the same: with whether at least one bell went out, for the caller
   * not to count an alert that reached nobody (every bell failing, the database down after the profiles were read).
   */
  async recordingStorage(kind: 'not_private' | 'check_failed', profileIds: string[], turnedOff: string[]): Promise<boolean> {
    if (!profileIds.length) return false;
    const profiles = await prisma.profile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, displayName: true, settings: true, workspace: { select: { organizationId: true } } },
    });
    const byOrg = new Map<string, typeof profiles>();
    for (const p of profiles) {
      const orgId = p.workspace?.organizationId;
      // Grouped under undefined, the bell and the WhatsApp alert would lose their organization filter (Prisma drops an
      // undefined condition): the admins of every organization would get the bell, and any organization's profile could
      // send the alert.
      if (orgId) byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), p]);
      else this.logger.warn(`Call recordings storage alert for ${clean(p.id)} skipped: the profile has no organization`);
    }
    const nameOf = (p: (typeof profiles)[number]) => p.displayName || p.id;
    let told = false;
    for (const [orgId, own] of byOrg) {
      const off = own.filter((p) => turnedOff.includes(p.id)).map(nameOf);
      const title = kind === 'not_private' ? 'Call recordings can be read without a login' : 'Call recordings storage could not be checked';
      const text =
        kind === 'not_private'
          ? 'The storage of call recordings serves its files without credentials: anyone who has an address can read them. ' +
            (off.length ? `Recording was turned off for ${off.join(', ')}. ` : '') +
            'Whoever runs this MultiWA server must make the storage private; recording can then be turned on again.'
          : `MultiWA could not check that the storage of call recordings refuses requests without credentials. Recording stays on for ${own.map(nameOf).join(', ')}. ` +
            'If this repeats, ask whoever runs this MultiWA server to check the storage.';
      try {
        await this.notifications.createForOrg(orgId, NotificationType.SYSTEM, title, text, { kind: 'call_recordings_storage', status: kind }, ['owner', 'admin']);
        told = true;
      } catch (e) {
        this.logger.warn(`Call recordings storage bell for ${orgId} failed: ${clean((e as Error)?.message ?? e)}`);
      }
      const recipients = [
        ...new Set(
          own.flatMap((p) => {
            const notify = (p.settings as Record<string, unknown> | null)?.quietAlarmNotify;
            return Array.isArray(notify) ? notify.filter((n): n is string => typeof n === 'string') : [];
          }),
        ),
      ];
      try {
        await sendOpsAlert(this.messages, this.logger, {
          what: `Call recordings storage alert for ${orgId}`,
          organizationId: orgId,
          excludeProfileId: '', // about the storage, not a profile: any connected profile may send it
          ownPhone: null,
          recipients,
          text: `⚠️ ${title}. ${text}`,
        });
      } catch (e) {
        this.logger.warn(`Call recordings storage alert for ${orgId} failed: ${clean((e as Error)?.message ?? e)}`);
      }
    }
    return told;
  }

  /**
   * A call on `profileId` was not recorded (the recorder did not start, or the announcement did not play; the call was
   * connected all the same), or its recording could not be stored after its tries (it is kept on the server and tried
   * again each night). The bell for the organization's owners and admins (recording is theirs), and WhatsApp to the
   * profile's alarm numbers, through another connected profile. At most once an hour per profile and kind.
   */
  async recordingFailed(kind: RecordingFailure, profileId: string, at = new Date()): Promise<void> {
    const key = `${profileId}:${kind}`;
    if (at.getTime() - (this.lastRecordingAlertAt.get(key) ?? -Infinity) < RECORDING_ALERT_EVERY_MS) return;
    const [p] = await prisma.profile.findMany({
      where: { id: { in: [profileId] } },
      select: { id: true, displayName: true, phoneNumber: true, settings: true, workspace: { select: { organizationId: true } } },
    });
    const orgId = p?.workspace?.organizationId;
    if (!p || !orgId) {
      this.logger.warn(`Call recording alert for ${clean(profileId)} skipped: the profile has no organization`);
      return;
    }
    const name = p.displayName || p.id;
    const title = kind === 'upload_failed' ? `Call recording not stored: ${name}` : `Call not recorded: ${name}`;
    const text =
      kind === 'upload_failed'
        ? `A call recording of ${name} could not be stored: the recordings storage did not take it after 4 tries. It is kept on this server and tried again tonight.`
        : `A call on ${name} was answered in the dashboard but not recorded: ` +
          (kind === 'recorder_failed' ? 'the recorder did not start. The call was connected.' : 'the announcement did not play to the caller. The call was connected without it.');
    try {
      await this.notifications.createForOrg(orgId, NotificationType.SYSTEM, title, text, { kind: 'call_recording_failed', status: kind }, ['owner', 'admin']);
      this.lastRecordingAlertAt.set(key, at.getTime());
    } catch (e) {
      this.logger.warn(`Call recording bell for ${clean(profileId)} failed: ${clean((e as Error)?.message ?? e)}`);
    }
    try {
      await sendOpsAlert(this.messages, this.logger, {
        what: `Call recording alert for ${p.id}`,
        organizationId: orgId,
        excludeProfileId: p.id,
        ownPhone: p.phoneNumber,
        recipients: (p.settings as Record<string, unknown> | null)?.quietAlarmNotify,
        text: `⚠️ ${title}. ${text}`,
      });
    } catch (e) {
      this.logger.warn(`Call recording alert for ${clean(profileId)} failed: ${clean((e as Error)?.message ?? e)}`);
    }
  }
}

// MultiWA Gateway - the call coordinator's alerts
// apps/api/src/modules/calls/coordinator/call-alerts.ts
//
// The media server's worker died: every call it carried lost its audio and was ended. Through the quiet-profile
// alarm's channel: the bell for every user of each organization that answers calls in the dashboard, told only of its
// own calls, and WhatsApp to the alarm numbers (quietAlarmNotify) of the profiles whose calls were cut, through
// another connected profile.
// And the recordings storage failing its privacy check: the same channel, per organization.
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

@Injectable()
export class CallAlerts {
  private readonly logger = new Logger(CallAlerts.name);
  // The quiet-profile alarm's time zone, so that both alerts read the same clock.
  private readonly timeZone = parseActiveWindow(process.env.QUIET_ALARM_ACTIVE_HOURS, process.env.QUIET_ALARM_TIMEZONE).timeZone;
  // Each organization's last bell that was sent, on the deaths' own clock (`at`): a bell lost to a database outage
  // starts no quiet window.
  private readonly lastBellAt = new Map<string, number>();

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
   * stays on. One bell per organization concerned, and WhatsApp to the alarm numbers of its profiles concerned. The
   * storage's address is never in the alert (the server log has it): the storage serves every organization of the server.
   */
  async recordingStorage(kind: 'not_private' | 'check_failed', profileIds: string[], turnedOff: string[]): Promise<void> {
    if (!profileIds.length) return;
    const profiles = await prisma.profile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, displayName: true, settings: true, workspace: { select: { organizationId: true } } },
    });
    const byOrg = new Map<string, typeof profiles>();
    for (const p of profiles) {
      const orgId = p.workspace?.organizationId;
      if (orgId) byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), p]);
    }
    const nameOf = (p: (typeof profiles)[number]) => p.displayName || p.id;
    for (const [orgId, own] of byOrg) {
      const off = own.filter((p) => turnedOff.includes(p.id)).map(nameOf);
      const title = kind === 'not_private' ? 'Call recordings can be read without a login' : 'Call recordings storage could not be checked';
      const text =
        kind === 'not_private'
          ? 'The storage of call recordings serves its files without credentials: anyone who has an address can read them. ' +
            (off.length ? `Recording was turned off for ${off.join(', ')}. ` : '') +
            'Make the storage private, then turn recording on again.'
          : `MultiWA could not check that the storage of call recordings refuses requests without credentials. Recording stays on for ${own.map(nameOf).join(', ')}.`;
      try {
        await this.notifications.createForOrg(orgId, NotificationType.SYSTEM, title, text, { kind: 'call_recordings_storage', status: kind });
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
  }
}

// MultiWA Gateway - the call coordinator's alerts
// apps/api/src/modules/calls/coordinator/call-alerts.ts
//
// The media server's worker died: every call it carried lost its audio and was ended. Through the quiet-profile
// alarm's channel: the bell for every user of each organization that answers calls in the dashboard, told only of its
// own calls, and WhatsApp to the alarm numbers (quietAlarmNotify) of the profiles whose calls were cut, through
// another connected profile.
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
}

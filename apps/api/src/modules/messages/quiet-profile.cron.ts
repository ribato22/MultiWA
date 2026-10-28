// MultiWA Gateway - Quiet-profile alarm
// apps/api/src/modules/messages/quiet-profile.cron.ts
//
// A connected profile that stops receiving messages (a "zombie" WhatsApp session) raises one alarm — the
// admin bell plus WhatsApp to its ops numbers through another connected profile — and one notice when
// incoming messages resume. Silence counts only within the active hours. Profile.quietAlarmAt holds the
// open alarm, so a restart neither repeats nor forgets it.

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import { activeMinutesBetween, parseActiveWindow, quietAlarmText, quietRecoveredText, windowLabel, type ActiveWindow } from './quiet-profile';

type QuietSettings = { quietAlarmHours?: number | null; quietAlarmNotify?: string[] };

interface ProfileRow {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
  settings: unknown;
  lastConnectedAt: Date | null;
  quietAlarmAt: Date | null;
  workspace: { organizationId: string } | null;
}

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
// The send gate's 429 keeps its reason in the body ({ error: 'REPEAT_SUPPRESSED', ... }) and its .message is only "Http Exception".
// `message` goes first: Nest bodies carry both ({ message: 'Invalid recipient: ...', error: 'Bad Request' }) and the message is the useful one.
const reason = (e: any) => {
  const body = typeof e?.getResponse === 'function' ? e.getResponse() : e?.message;
  return clean(typeof body === 'string' ? body : body?.message ?? body?.error ?? JSON.stringify(body));
};
const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);
// Digits of a number or JID ("+62 812-3456-789", "62812…@s.whatsapp.net"). A local 08… counts as 628…, the way normalizeJid sends it.
const digits = (s: unknown) => String(s).replace(/@.*$/, '').replace(/\D/g, '').replace(/^0/, '62');

@Injectable()
export class QuietProfileCron {
  private readonly logger = new Logger(QuietProfileCron.name);
  private readonly window: ActiveWindow = parseActiveWindow(process.env.QUIET_ALARM_ACTIVE_HOURS, process.env.QUIET_ALARM_TIMEZONE);

  constructor(
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
    private readonly notifications: NotificationsService,
  ) {
    this.logger.log(`Quiet-profile alarm active hours: ${windowLabel(this.window)}`);
  }

  // The cron library calls the job with its `onComplete` as the first argument, so the schedule sits on this
  // wrapper and the sweep takes its clock explicitly.
  @Cron('*/5 * * * *')
  tick(): Promise<void> {
    return this.checkQuietProfiles(new Date());
  }

  async checkQuietProfiles(now: Date): Promise<void> {
    let profiles: ProfileRow[];
    try {
      profiles = await prisma.profile.findMany({
        select: {
          id: true, displayName: true, phoneNumber: true, status: true, settings: true,
          lastConnectedAt: true, quietAlarmAt: true, workspace: { select: { organizationId: true } },
        },
      });
    } catch (e) {
      this.logger.warn(`Quiet-profile sweep failed: ${clean((e as Error).message)}`);
      return;
    }
    for (const p of profiles) {
      try {
        await this.check(p, now);
      } catch (e) {
        this.logger.warn(`Quiet-profile check for ${p.id} failed: ${clean((e as Error).message)}`);
      }
    }
  }

  private async check(p: ProfileRow, now: Date): Promise<void> {
    const settings = (p.settings ?? {}) as QuietSettings;
    const hours = typeof settings.quietAlarmHours === 'number' && settings.quietAlarmHours > 0 ? settings.quietAlarmHours : null;

    if (!hours) {
      // Turned off while an alarm was open: close it without a notice.
      if (p.quietAlarmAt) await prisma.profile.updateMany({ where: { id: p.id, quietAlarmAt: p.quietAlarmAt }, data: { quietAlarmAt: null } });
      return;
    }

    // Nothing to raise and nothing to close: skip the lookup.
    if (!p.quietAlarmAt && p.status !== 'connected') return;

    // One clock: `now`, quietAlarmAt and lastConnectedAt are this host's, so the message time is its createdAt (when the
    // host stored it), not `timestamp` (WhatsApp's clock). Ordering by timestamp keeps the (profileId, timestamp) index in use.
    const last = await prisma.message.findFirst({
      where: { profileId: p.id, direction: 'incoming' },
      orderBy: { timestamp: 'desc' },
      select: { createdAt: true },
    });
    const lastIncomingAt = last?.createdAt ?? null;

    if (p.quietAlarmAt) {
      if (lastIncomingAt && lastIncomingAt > p.quietAlarmAt) {
        const cleared = await prisma.profile.updateMany({ where: { id: p.id, quietAlarmAt: p.quietAlarmAt }, data: { quietAlarmAt: null } });
        if (cleared.count) await this.notify(p, settings, 'recovered', p.quietAlarmAt, now);
      }
      return;
    }

    const since = latest(lastIncomingAt, p.lastConnectedAt);
    if (!since) return;
    const threshold = hours * 60;
    if (activeMinutesBetween(since, now, this.window, threshold) < threshold) return;

    // Before the compare-and-set: notify() cannot send without an organization, and a raised-but-unsent episode would be lost.
    if (!p.workspace?.organizationId) {
      this.logger.warn(`Quiet-profile alarm for ${p.id} skipped: the profile has no organization`);
      return;
    }
    const raised = await prisma.profile.updateMany({ where: { id: p.id, quietAlarmAt: null }, data: { quietAlarmAt: now } });
    if (raised.count) await this.notify(p, settings, 'quiet', since, now);
  }

  private async notify(p: ProfileRow, settings: QuietSettings, kind: 'quiet' | 'recovered', at: Date, now: Date): Promise<void> {
    const name = p.displayName || p.id;
    const who = { name, phone: p.phoneNumber };
    const quiet = kind === 'quiet';
    const text = quiet ? quietAlarmText(who, at, now, this.window.timeZone) : quietRecoveredText(who, at, this.window.timeZone);
    const orgId = p.workspace?.organizationId;
    if (!orgId) return;

    try {
      await this.notifications.createForOrg(
        orgId,
        quiet ? NotificationType.DISCONNECTION : NotificationType.CONNECTION,
        quiet ? `${name} is receiving no messages` : `${name} is receiving messages again`,
        text,
        { profileId: p.id, kind: quiet ? 'quiet_profile' : 'quiet_profile_recovered' },
      );
    } catch (e) {
      this.logger.warn(`Quiet-profile bell for ${p.id} failed: ${clean((e as Error).message)}`);
    }

    const to = Array.isArray(settings.quietAlarmNotify) ? settings.quietAlarmNotify : [];
    if (!to.length) return;
    const sender = await prisma.profile.findFirst({
      where: { id: { not: p.id }, status: 'connected', quietAlarmAt: null, workspace: { organizationId: orgId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!sender) {
      this.logger.warn(`Quiet-profile alarm for ${p.id}: no other connected profile to send it through, bell only`);
      return;
    }
    // An alarm sent to the quiet profile's own number would arrive as an incoming message and close its own alarm.
    const own = p.phoneNumber ? digits(p.phoneNumber) : '';
    for (const recipient of to) {
      if (own && digits(recipient) === own) continue;
      try {
        const res = await this.messagesService.sendText({ profileId: sender.id, to: recipient, text });
        if (res?.success === false) this.logger.warn(`Quiet-profile alarm for ${p.id} not sent through ${sender.id}: ${clean(res.error ?? 'failed')}`);
      } catch (e) {
        this.logger.warn(`Quiet-profile alarm for ${p.id} not sent through ${sender.id}: ${reason(e)}`);
      }
    }
  }
}

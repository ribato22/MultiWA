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
const latest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);

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

  @Cron('*/5 * * * *')
  async checkQuietProfiles(now: Date = new Date()): Promise<void> {
    let profiles: ProfileRow[];
    try {
      profiles = (await prisma.profile.findMany({
        select: {
          id: true, displayName: true, phoneNumber: true, status: true, settings: true,
          lastConnectedAt: true, quietAlarmAt: true, workspace: { select: { organizationId: true } },
        },
      })) as ProfileRow[];
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

    const last = await prisma.message.findFirst({
      where: { profileId: p.id, direction: 'incoming' },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    const lastIncomingAt = last?.timestamp ?? null;

    if (p.quietAlarmAt) {
      if (lastIncomingAt && lastIncomingAt > p.quietAlarmAt) {
        const cleared = await prisma.profile.updateMany({ where: { id: p.id, quietAlarmAt: p.quietAlarmAt }, data: { quietAlarmAt: null } });
        if (cleared.count) await this.notify(p, settings, 'recovered', p.quietAlarmAt, now);
      }
      return;
    }

    if (p.status !== 'connected') return;
    const since = latest(lastIncomingAt, p.lastConnectedAt);
    if (!since) return;
    const threshold = hours * 60;
    if (activeMinutesBetween(since, now, this.window, threshold) < threshold) return;

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
    for (const recipient of to) {
      try {
        const res: any = await this.messagesService.sendText({ profileId: sender.id, to: recipient, text } as any);
        if (res?.success === false) this.logger.warn(`Quiet-profile alarm for ${p.id} not sent through ${sender.id}: ${clean(res.error ?? 'failed')}`);
      } catch (e) {
        this.logger.warn(`Quiet-profile alarm for ${p.id} not sent through ${sender.id}: ${clean((e as Error).message)}`);
      }
    }
  }
}

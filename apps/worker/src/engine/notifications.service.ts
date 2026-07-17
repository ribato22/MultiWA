// MultiWA Gateway - Worker notifications (in-app)
// apps/worker/src/engine/notifications.service.ts
//
// Worker-local copy of the API NotificationsService: creates the per-user in-app
// notification rows the admin bell shows AND fans out email/push (best-effort)
// for engine events in worker mode.

import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { EmailService, PushService } from '@multiwa/engine-runtime';

export enum NotificationType {
  MESSAGE = 'message',
  CONNECTION = 'connection',
  DISCONNECTION = 'disconnection',
  BROADCAST = 'broadcast',
  AUTOMATION = 'automation',
  SYSTEM = 'system',
  SECURITY = 'security',
}

@Injectable()
export class WorkerNotificationsService {
  private readonly logger = new Logger(WorkerNotificationsService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
  ) {}

  async createForOrg(
    orgId: string,
    type: NotificationType,
    title: string,
    body: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, preferences: true },
    });

    for (const user of users) {
      if (!this.isNotificationEnabled(user.preferences as any, type)) continue;
      await prisma.notification
        .create({ data: { userId: user.id, type, title, body, metadata: metadata || undefined } })
        .catch((err) => this.logger.warn(`Notification create failed: ${(err as Error).message}`));
      // Fire-and-forget email/push (best-effort).
      this.sendEmailIfEnabled(user.id, title, body).catch((err) => this.logger.warn(`Email notification failed: ${err.message}`));
      this.sendPushIfEnabled(user.id, title, body, metadata).catch((err) => this.logger.warn(`Push notification failed: ${err.message}`));
    }
  }

  private async sendEmailIfEnabled(userId: string, title: string, body: string): Promise<void> {
    if (!this.emailService.enabled) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, preferences: true } });
    if (!user?.email) return;
    const prefs = (user.preferences as any) || {};
    if (prefs.emailNotifications === false) return;
    await this.emailService.send({ to: user.email, subject: `[MultiWA] ${title}`, text: body });
  }

  private async sendPushIfEnabled(userId: string, title: string, body: string, metadata?: Record<string, any>): Promise<void> {
    if (!this.pushService.enabled) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
    const prefs = (user?.preferences as any) || {};
    if (prefs.pushNotifications === false) return;
    await this.pushService.sendPush(userId, title, body, metadata);
  }

  private isNotificationEnabled(preferences: any, type: NotificationType): boolean {
    if (!preferences || typeof preferences !== 'object') return true;
    switch (type) {
      case NotificationType.MESSAGE:
        return preferences.notifyOnMessage !== false;
      case NotificationType.CONNECTION:
        return preferences.notifyOnConnect !== false;
      case NotificationType.DISCONNECTION:
        return preferences.notifyOnDisconnect !== false;
      default:
        return true;
    }
  }
}

// MultiWA Gateway - Worker notifications (in-app)
// apps/worker/src/engine/notifications.service.ts
//
// Worker-local copy of the in-app part of the API NotificationsService: creates
// the per-user notification rows the admin bell shows, for engine events in
// worker mode. Email/push fan-out is intentionally NOT ported here (best-effort,
// the API path retains it); only the durable in-app rows are written.

import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';

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
    }
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

// MultiWA Gateway API - Notifications Service
// apps/api/src/modules/notifications/notifications.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { EmailService } from './email.service';
import { PushService } from './push.service';

export enum NotificationType {
  MESSAGE = 'message',
  CONNECTION = 'connection',
  DISCONNECTION = 'disconnection',
  BROADCAST = 'broadcast',
  AUTOMATION = 'automation',
  SYSTEM = 'system',
  SECURITY = 'security',
}

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly pushService: PushService,
  ) {}

  /**
   * Create a notification and optionally send via enabled channels
   */
  async create(dto: CreateNotificationDto) {
    const notification = await prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        metadata: dto.metadata || undefined,
      },
    });

    this.logger.debug(`Notification created: [${dto.type}] ${dto.title} for user ${dto.userId}`);

    // Fire-and-forget: send email if user has it enabled
    this.sendEmailIfEnabled(dto.userId, dto.title, dto.body).catch(err =>
      this.logger.warn(`Email notification failed: ${err.message}`),
    );

    // Fire-and-forget: send push notification if user has subscriptions
    this.sendPushIfEnabled(dto.userId, dto.title, dto.body, dto.metadata).catch(err =>
      this.logger.warn(`Push notification failed: ${err.message}`),
    );

    return notification;
  }

  /**
   * Create notifications for all users in an organization
   */
  async createForOrg(orgId: string, type: NotificationType, title: string, body: string, metadata?: Record<string, any>) {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, email: true, preferences: true },
    });

    const notifications = [];
    for (const user of users) {
      if (this.isNotificationEnabled(user.preferences as any, type)) {
        const notif = await this.create({
          userId: user.id,
          type,
          title,
          body,
          metadata,
        });
        notifications.push(notif);
      }
    }

    return notifications;
  }

  /**
   * Get notifications for a user
   */
  async getAll(userId: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }) {
    const { unreadOnly = false, limit = 50, offset = 0 } = options || {};

    const where: any = { userId };
    if (unreadOnly) {
      where.isRead = false;
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
    ]);

    return { notifications, total };
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Delete a single notification
   */
  async delete(notificationId: string, userId: string) {
    return prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
  }

  /**
   * Clear all notifications for a user
   */
  async clearAll(userId: string) {
    return prisma.notification.deleteMany({
      where: { userId },
    });
  }

  /**
   * Check if a notification type is enabled in user preferences
   */
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

  /**
   * Send email notification if user has email channel enabled
   */
  private async sendEmailIfEnabled(userId: string, title: string, body: string) {
    if (!this.emailService.enabled) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, preferences: true },
    });

    if (!user?.email) return;

    const prefs = (user.preferences as any) || {};
    if (prefs.emailNotifications === false) return;

    await this.emailService.send({
      to: user.email,
      subject: `[MultiWA] ${title}`,
      text: body,
    });
  }

  /**
   * Send push notification if user has push enabled
   */
  private async sendPushIfEnabled(userId: string, title: string, body: string, metadata?: Record<string, any>) {
    if (!this.pushService.enabled) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const prefs = (user?.preferences as any) || {};
    if (prefs.pushNotifications === false) return;

    await this.pushService.sendPush(userId, title, body, metadata);
  }
}

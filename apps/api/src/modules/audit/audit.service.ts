// MultiWA Gateway - Audit Service
// apps/api/src/modules/audit/audit.service.ts

import { Injectable } from '@nestjs/common';
import { prisma } from '@multiwa/database';

export enum AuditAction {
  // Auth
  LOGIN = 'auth.login',
  LOGOUT = 'auth.logout',
  LOGIN_FAILED = 'auth.login_failed',
  REGISTER = 'auth.register',
  PASSWORD_CHANGE = 'auth.password_change',
  MFA_ENABLE = 'auth.mfa_enable',
  MFA_DISABLE = 'auth.mfa_disable',

  // Organization
  ORG_CREATE = 'org.create',
  ORG_UPDATE = 'org.update',
  ORG_DELETE = 'org.delete',

  // User
  USER_INVITE = 'user.invite',
  USER_ROLE_CHANGE = 'user.role_change',
  USER_REMOVE = 'user.remove',

  // Profile (WhatsApp)
  PROFILE_CREATE = 'profile.create',
  PROFILE_UPDATE = 'profile.update',
  PROFILE_DELETE = 'profile.delete',
  PROFILE_CONNECT = 'profile.connect',
  PROFILE_DISCONNECT = 'profile.disconnect',

  // Messages
  MESSAGE_SEND = 'message.send',
  MESSAGE_BULK_SEND = 'message.bulk_send',
  MESSAGE_DELETE = 'message.delete',

  // Broadcast
  BROADCAST_CREATE = 'broadcast.create',
  BROADCAST_START = 'broadcast.start',
  BROADCAST_PAUSE = 'broadcast.pause',
  BROADCAST_CANCEL = 'broadcast.cancel',
  BROADCAST_DELETE = 'broadcast.delete',

  // Automation
  AUTOMATION_CREATE = 'automation.create',
  AUTOMATION_UPDATE = 'automation.update',
  AUTOMATION_DELETE = 'automation.delete',
  AUTOMATION_TOGGLE = 'automation.toggle',
  AUTOMATION_TRIGGER = 'automation.trigger',

  // Contacts
  CONTACT_CREATE = 'contact.create',
  CONTACT_UPDATE = 'contact.update',
  CONTACT_IMPORT = 'contact.import',
  CONTACT_EXPORT = 'contact.export',
  CONTACT_DELETE = 'contact.delete',
  CONTACT_SYNC = 'contact.sync',

  // Templates
  TEMPLATE_CREATE = 'template.create',
  TEMPLATE_UPDATE = 'template.update',
  TEMPLATE_DELETE = 'template.delete',
  TEMPLATE_DUPLICATE = 'template.duplicate',

  // Conversations
  CONVERSATION_ARCHIVE = 'conversation.archive',
  CONVERSATION_DELETE = 'conversation.delete',
  CONVERSATION_CLEAR = 'conversation.clear',
  CONVERSATION_MUTE = 'conversation.mute',
  CONVERSATION_PIN = 'conversation.pin',

  // Groups
  GROUP_CREATE = 'group.create',
  GROUP_UPDATE = 'group.update',
  GROUP_ADD_PARTICIPANT = 'group.add_participant',
  GROUP_REMOVE_PARTICIPANT = 'group.remove_participant',
  GROUP_LEAVE = 'group.leave',

  // API Key
  APIKEY_CREATE = 'apikey.create',
  APIKEY_REVOKE = 'apikey.revoke',

  // Webhook
  WEBHOOK_CREATE = 'webhook.create',
  WEBHOOK_UPDATE = 'webhook.update',
  WEBHOOK_DELETE = 'webhook.delete',

  // Settings
  SETTINGS_UPDATE = 'settings.update',
}

export interface AuditLogEntry {
  action: AuditAction | string;
  userId?: string;
  organizationId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  // Log an audit event
  async log(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId,
        organizationId: entry.organizationId,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata || {},
        ip: entry.ip,
        userAgent: entry.userAgent,
        timestamp: new Date(),
      },
    });
  }

  // Query audit logs
  async query(options: {
    organizationId?: string;
    userId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};

    if (options.organizationId) where.organizationId = options.organizationId;
    if (options.userId) where.userId = options.userId;
    if (options.action) where.action = { startsWith: options.action };
    if (options.resourceType) where.resourceType = options.resourceType;
    if (options.resourceId) where.resourceId = options.resourceId;

    if (options.startDate || options.endDate) {
      where.timestamp = {};
      if (options.startDate) where.timestamp.gte = options.startDate;
      if (options.endDate) where.timestamp.lte = options.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        take: options.limit || 50,
        skip: options.offset || 0,
        orderBy: { timestamp: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      total,
      limit: options.limit || 50,
      offset: options.offset || 0,
    };
  }

  // Get audit summary statistics
  async getSummary(organizationId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        organizationId,
        timestamp: { gte: startDate },
      },
      _count: { action: true },
    });

    // Group by category
    const byCategory: Record<string, number> = {};
    logs.forEach((log) => {
      const category = log.action.split('.')[0];
      byCategory[category] = (byCategory[category] || 0) + log._count.action;
    });

    // Daily activity
    const daily = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM "audit_logs"
      WHERE "organizationId" = ${organizationId}
        AND timestamp >= ${startDate}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `;

    return {
      byAction: logs.map((l) => ({ action: l.action, count: l._count.action })),
      byCategory,
      daily: daily.map((d) => ({ date: d.date, count: Number(d.count) })),
      totalLogs: logs.reduce((sum, l) => sum + l._count.action, 0),
    };
  }

  // Helper to log with request context
  static fromRequest(req: any): Partial<AuditLogEntry> {
    return {
      userId: req.user?.id,
      ip: req.ip || req.headers?.['x-forwarded-for'],
      userAgent: req.headers?.['user-agent'],
    };
  }
}

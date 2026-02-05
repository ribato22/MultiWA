// MultiWA Gateway - GDPR Compliance Controller
// apps/api/src/modules/accounts/gdpr.controller.ts

import { Controller, Get, Delete, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { prisma } from '@multiwa/database';

/**
 * GDPR-compliant data export and account deletion endpoints.
 * Enables users to exercise their "Right to Access" and "Right to Erasure".
 */
@ApiTags('GDPR / Privacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('account')
export class GdprController {
  private readonly logger = new Logger(GdprController.name);

  /**
   * Right to Access — Export all personal data as JSON.
   * Returns user profile, messages, contacts, automations,
   * and audit logs associated with the authenticated user.
   */
  @Get('export')
  @ApiOperation({ summary: 'Export all personal data (GDPR Art. 15)' })
  @ApiResponse({ status: 200, description: 'JSON archive of all user data' })
  async exportData(@Req() req: any) {
    const userId = req.user.id;
    const organizationId = req.user.organizationId;
    this.logger.log(`GDPR data export requested by user ${userId}`);

    // Gather all user-related data in parallel
    const [user, auditLogs, pushSubscriptions, notifications, sessions] =
      await Promise.all([
        // User profile (exclude secrets)
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            preferences: true,
            twoFactorEnabled: true,
            organizationId: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            // Exclude: passwordHash, twoFactorSecret, backupCodes
          },
        }),

        // Audit logs
        prisma.auditLog.findMany({
          where: { userId },
          select: {
            id: true,
            action: true,
            resourceType: true,
            resourceId: true,
            metadata: true,
            ip: true,
            userAgent: true,
            timestamp: true,
          },
          orderBy: { timestamp: 'desc' },
          take: 5000,
        }),

        // Push subscriptions
        prisma.pushSubscription.findMany({
          where: { userId },
          select: {
            id: true,
            endpoint: true,
            userAgent: true,
            createdAt: true,
          },
        }),

        // Notifications
        prisma.notification.findMany({
          where: { userId },
          select: {
            id: true,
            type: true,
            title: true,
            body: true,
            isRead: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        }),

        // Sessions
        prisma.session.findMany({
          where: { userId },
          select: {
            id: true,
            ipAddress: true,
            userAgent: true,
            lastActiveAt: true,
            createdAt: true,
          },
        }),
      ]);

    // Get organization workspaces → profiles → profile-dependent data
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const workspaceIds = workspaces.map((w) => w.id);

    const profiles = await prisma.profile.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: {
        id: true,
        displayName: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
      },
    });
    const profileIds = profiles.map((p) => p.id);

    // Fetch profile-dependent data
    const [messages, contacts, automations] = await Promise.all([
      profileIds.length > 0
        ? prisma.message.findMany({
            where: { profileId: { in: profileIds } },
            select: {
              id: true,
              messageId: true,
              senderJid: true,
              direction: true,
              type: true,
              content: true,
              status: true,
              timestamp: true,
            },
            orderBy: { timestamp: 'desc' },
            take: 10000,
          })
        : [],

      profileIds.length > 0
        ? prisma.contact.findMany({
            where: { profileId: { in: profileIds } },
            select: {
              id: true,
              name: true,
              phone: true,
              whatsappName: true,
              tags: true,
              createdAt: true,
            },
          })
        : [],

      profileIds.length > 0
        ? prisma.automation.findMany({
            where: { profileId: { in: profileIds } },
            select: {
              id: true,
              name: true,
              triggerType: true,
              isActive: true,
              createdAt: true,
            },
          })
        : [],
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      gdprArticle: 'Art. 15 — Right of Access',
      user,
      statistics: {
        totalMessages: messages.length,
        totalContacts: contacts.length,
        totalAutomations: automations.length,
        totalAuditLogs: auditLogs.length,
        totalNotifications: notifications.length,
        totalPushSubscriptions: pushSubscriptions.length,
        totalSessions: sessions.length,
        totalProfiles: profiles.length,
      },
      profiles,
      messages,
      contacts,
      automations,
      auditLogs,
      notifications,
      pushSubscriptions,
      sessions,
    };

    this.logger.log(`GDPR export completed for user ${userId}: ${JSON.stringify(exportData.statistics)}`);
    return exportData;
  }

  /**
   * Right to Erasure — Delete account and all associated data.
   * This action is IRREVERSIBLE. Cascade-deletes all user data.
   */
  @Delete('delete')
  @ApiOperation({ summary: 'Delete account and all data (GDPR Art. 17)' })
  @ApiResponse({ status: 200, description: 'Account and all data permanently deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteAccount(@Req() req: any) {
    const userId = req.user.id;
    this.logger.warn(`GDPR account deletion requested by user ${userId}`);

    const deletionLog: Record<string, number> = {};

    // 1. Push subscriptions
    const pushResult = await prisma.pushSubscription.deleteMany({ where: { userId } });
    deletionLog.pushSubscriptions = pushResult.count;

    // 2. Notifications
    const notifResult = await prisma.notification.deleteMany({ where: { userId } });
    deletionLog.notifications = notifResult.count;

    // 3. Audit logs
    const auditResult = await prisma.auditLog.deleteMany({ where: { userId } });
    deletionLog.auditLogs = auditResult.count;

    // 4. Sessions
    const sessionResult = await prisma.session.deleteMany({ where: { userId } });
    deletionLog.sessions = sessionResult.count;

    // 5. API keys
    const apiKeyResult = await prisma.apiKey.deleteMany({ where: { userId } });
    deletionLog.apiKeys = apiKeyResult.count;

    // 6. User roles
    const roleResult = await prisma.userRole.deleteMany({ where: { userId } });
    deletionLog.userRoles = roleResult.count;

    // 7. Delete user record (other data cascades via FK constraints)
    await prisma.user.delete({ where: { id: userId } });
    deletionLog.user = 1;

    this.logger.warn(`GDPR account deletion completed for user ${userId}: ${JSON.stringify(deletionLog)}`);

    return {
      success: true,
      gdprArticle: 'Art. 17 — Right to Erasure',
      deletedAt: new Date().toISOString(),
      deletionSummary: deletionLog,
      message: 'Your account and all associated data have been permanently deleted.',
    };
  }
}

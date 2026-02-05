// MultiWA Gateway - Statistics Service
// apps/api/src/modules/statistics/statistics.service.ts

import { Injectable } from '@nestjs/common';
import { prisma } from '@multiwa/database';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class StatisticsService {
  // ============================================
  // Dashboard Overview
  // ============================================

  async getDashboard(organizationId?: string) {
    // When organizationId is empty/undefined, return stats across ALL profiles
    const profileWhere = organizationId ? { workspace: { organizationId } } : {};
    
    const profiles = await prisma.profile.findMany({
      where: profileWhere,
      select: { id: true },
    });
    const profileIds = profiles.map(p => p.id);
    const messageWhere = profileIds.length > 0 ? { profileId: { in: profileIds } } : {};

    const [
      totalProfiles,
      connectedProfiles,
      totalMessages,
      totalContacts,
      totalBroadcasts,
      todayMessages,
    ] = await Promise.all([
      prisma.profile.count({ where: profileWhere }),
      prisma.profile.count({ where: { ...profileWhere, status: 'connected' } }),
      prisma.message.count({ where: messageWhere }),
      prisma.contact.count({ where: messageWhere }),
      prisma.broadcast.count({ where: messageWhere }),
      prisma.message.count({
        where: {
          ...messageWhere,
          timestamp: { gte: this.startOfDay() },
        },
      }),
    ]);

    return {
      profiles: { total: totalProfiles, connected: connectedProfiles },
      messages: { total: totalMessages, today: todayMessages },
      contacts: { total: totalContacts },
      broadcasts: { total: totalBroadcasts },
    };
  }

  // ============================================
  // Message Statistics
  // ============================================

  async getMessageStats(profileId: string, range: DateRange) {
    const where = {
      profileId,
      timestamp: { gte: range.startDate, lte: range.endDate },
    };

    const [total, byDirection, byType, byStatus, hourly] = await Promise.all([
      prisma.message.count({ where }),

      prisma.message.groupBy({
        by: ['direction'],
        where,
        _count: { direction: true },
      }),

      prisma.message.groupBy({
        by: ['type'],
        where,
        _count: { type: true },
      }),

      prisma.message.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),

      this.getHourlyDistribution(profileId, range),
    ]);

    return {
      total,
      byDirection: Object.fromEntries(byDirection.map(d => [d.direction, d._count.direction])),
      byType: Object.fromEntries(byType.map(t => [t.type, t._count.type])),
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.status])),
      hourly,
      averagePerDay: Math.round(total / this.daysBetween(range.startDate, range.endDate)),
    };
  }

  async getMessageTrend(profileId: string, range: DateRange, granularity: 'hour' | 'day' | 'week') {
    const format = granularity === 'hour' ? 'YYYY-MM-DD HH24:00' 
                 : granularity === 'week' ? 'IYYY-"W"IW'
                 : 'YYYY-MM-DD';

    // Using raw query for time-series aggregation
    const trend = await prisma.$queryRaw<{ period: string; incoming: bigint; outgoing: bigint }[]>`
      SELECT 
        TO_CHAR(timestamp, ${format}) as period,
        COUNT(*) FILTER (WHERE direction = 'incoming') as incoming,
        COUNT(*) FILTER (WHERE direction = 'outgoing') as outgoing
      FROM "messages"
      WHERE "profileId" = ${profileId}
        AND timestamp BETWEEN ${range.startDate} AND ${range.endDate}
      GROUP BY period
      ORDER BY period ASC
    `;

    return trend.map(t => ({
      period: t.period,
      incoming: Number(t.incoming),
      outgoing: Number(t.outgoing),
    }));
  }

  // ============================================
  // Contact Statistics
  // ============================================

  async getContactStats(profileId: string) {
    const [total, withTags, recentlyActive, topTags, growth] = await Promise.all([
      prisma.contact.count({ where: { profileId } }),

      prisma.contact.count({ 
        where: { profileId, tags: { isEmpty: false } } 
      }),

      prisma.contact.count({
        where: {
          profileId,
          updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),

      this.getTopTags(profileId),

      this.getContactGrowth(profileId, 30),
    ]);

    return {
      total,
      withTags,
      withoutTags: total - withTags,
      recentlyActive,
      topTags,
      growth,
    };
  }

  private async getTopTags(profileId: string, limit: number = 10) {
    const contacts = await prisma.contact.findMany({
      where: { profileId },
      select: { tags: true },
    });

    const tagCounts: Record<string, number> = {};
    contacts.forEach(c => {
      c.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    return Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  }

  private async getContactGrowth(profileId: string, days: number) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const growth = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT TO_CHAR(DATE("createdAt"), 'YYYY-MM-DD') as date, COUNT(*) as count
      FROM "contacts"
      WHERE "profileId" = ${profileId}
        AND "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    return growth.map(g => ({ date: g.date, count: Number(g.count) }));
  }

  // ============================================
  // Broadcast Statistics
  // ============================================

  async getBroadcastStats(profileId: string) {
    const broadcasts = await prisma.broadcast.findMany({
      where: { profileId },
      select: { id: true, name: true, status: true, stats: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let totalSent = 0;
    let totalDelivered = 0;
    let totalFailed = 0;

    broadcasts.forEach(b => {
      const stats = b.stats as any;
      totalSent += stats.sent || 0;
      totalDelivered += stats.delivered || 0;
      totalFailed += stats.failed || 0;
    });

    const byStatus = await prisma.broadcast.groupBy({
      by: ['status'],
      where: { profileId },
      _count: { status: true },
    });

    return {
      total: broadcasts.length,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.status])),
      messages: { sent: totalSent, delivered: totalDelivered, failed: totalFailed },
      deliveryRate: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
      recentBroadcasts: broadcasts.slice(0, 5),
    };
  }

  // ============================================
  // Automation Statistics
  // ============================================

  async getAutomationStats(profileId: string) {
    const automations = await prisma.automation.findMany({
      where: { profileId },
      select: { id: true, name: true, isActive: true, triggerType: true, stats: true },
    });

    let totalTriggers = 0;
    const byType: Record<string, number> = {};

    automations.forEach(a => {
      const stats = a.stats as any;
      totalTriggers += stats.triggerCount || 0;
      byType[a.triggerType] = (byType[a.triggerType] || 0) + 1;
    });

    const active = automations.filter(a => a.isActive).length;

    return {
      total: automations.length,
      active,
      inactive: automations.length - active,
      totalTriggers,
      byType,
      topAutomations: automations
        .sort((a, b) => ((b.stats as any).triggerCount || 0) - ((a.stats as any).triggerCount || 0))
        .slice(0, 5)
        .map(a => ({
          id: a.id,
          name: a.name,
          triggerCount: (a.stats as any).triggerCount || 0,
        })),
    };
  }

  // ============================================
  // Response Time Analytics
  // ============================================

  async getResponseTimeStats(profileId: string, range: DateRange) {
    // This would require conversation-level tracking in production
    // For now, return mock structure
    return {
      averageResponseTime: 45, // seconds
      medianResponseTime: 30,
      percentile95: 120,
      byHour: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        avgResponseTime: Math.floor(Math.random() * 60) + 20,
      })),
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private async getHourlyDistribution(profileId: string, range: DateRange) {
    const hourly = await prisma.$queryRaw<{ hour: number; count: bigint }[]>`
      SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as count
      FROM "messages"
      WHERE "profileId" = ${profileId}
        AND timestamp BETWEEN ${range.startDate} AND ${range.endDate}
      GROUP BY hour
      ORDER BY hour ASC
    `;

    // Fill in missing hours with 0
    const result = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    hourly.forEach(h => {
      result[Number(h.hour)].count = Number(h.count);
    });

    return result;
  }

  private startOfDay(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private daysBetween(start: Date, end: Date): number {
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  }
}

// MultiWA Gateway - Active Session Management Service
// apps/api/src/modules/auth/sessions.service.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  /**
   * Create a new session when user logs in.
   */
  async createSession(
    userId: string,
    accessToken: string,
    ipAddress?: string,
    userAgent?: string,
    expiresInDays: number = 7,
  ): Promise<string> {
    const tokenHash = this.hashToken(accessToken);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        userId,
        tokenHash,
        ipAddress: ipAddress || null,
        userAgent: userAgent ? userAgent.substring(0, 255) : null,
        expiresAt,
      },
    });

    this.logger.log(`Session created for user ${userId} from ${ipAddress || 'unknown'}`);
    return session.id;
  }

  /**
   * Validate a session by token.
   */
  async validateSession(accessToken: string): Promise<boolean> {
    const tokenHash = this.hashToken(accessToken);

    const session = await prisma.session.findUnique({
      where: { tokenHash },
    });

    if (!session || session.expiresAt < new Date()) {
      return false;
    }

    // Update last active time
    await prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {}); // Non-critical update

    return true;
  }

  /**
   * Get all active sessions for a user.
   */
  async getActiveSessions(userId: string) {
    const sessions = await prisma.session.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    return sessions.map((s) => ({
      ...s,
      // Parse user agent for display
      device: this.parseUserAgent(s.userAgent),
    }));
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await prisma.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await prisma.session.delete({ where: { id: sessionId } });
    this.logger.log(`Session ${sessionId} revoked for user ${userId}`);
  }

  /**
   * Revoke all sessions except the current one.
   */
  async revokeAllSessions(userId: string, currentToken?: string): Promise<number> {
    const where: any = { userId };

    if (currentToken) {
      const currentHash = this.hashToken(currentToken);
      where.tokenHash = { not: currentHash };
    }

    const result = await prisma.session.deleteMany({ where });
    this.logger.log(`Revoked ${result.count} sessions for user ${userId}`);
    return result.count;
  }

  /**
   * Remove a session by token (on logout).
   */
  async removeSessionByToken(accessToken: string): Promise<void> {
    const tokenHash = this.hashToken(accessToken);
    await prisma.session.deleteMany({ where: { tokenHash } });
  }

  /**
   * Cleanup expired sessions (called periodically).
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired sessions`);
    }
    return result.count;
  }

  /**
   * Hash a token for storage (don't store raw tokens).
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Simple user agent parser for display purposes.
   */
  private parseUserAgent(ua: string | null): string {
    if (!ua) return 'Unknown Device';

    if (ua.includes('Chrome') && !ua.includes('Edge')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    if (ua.includes('Postman')) return 'Postman';
    if (ua.includes('curl')) return 'cURL';
    if (ua.includes('axios') || ua.includes('node-fetch')) return 'API Client';
    return 'Other';
  }
}

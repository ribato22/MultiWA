// MultiWA Gateway API - Push Notification Service
// apps/api/src/modules/notifications/push.service.ts

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as webpush from 'web-push';

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private isConfigured = false;

  @Optional()
  @Inject('SETTINGS_SERVICE')
  private settingsService: any;

  async onModuleInit() {
    await this.configure();
  }

  /**
   * Configure VAPID details from DB or auto-generate
   */
  private async configure() {
    try {
      let vapidConfig = this.settingsService
        ? await this.settingsService.get('vapid')
        : null;

      this.logger.log(`VAPID config from DB: ${vapidConfig ? 'found' : 'not found'}`);

      if (!vapidConfig) {
        // Auto-generate VAPID keys
        const keys = webpush.generateVAPIDKeys();
        vapidConfig = {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          subject: 'mailto:admin@multiwa.id',
        };

        // Save to DB
        if (this.settingsService) {
          await this.settingsService.set('vapid', vapidConfig);
          this.logger.log('Generated and saved new VAPID keys');
        }
      }

      this.logger.log(`VAPID publicKey (first 20 chars): ${vapidConfig.publicKey?.substring(0, 20)}...`);

      webpush.setVapidDetails(
        vapidConfig.subject || 'mailto:admin@multiwa.id',
        vapidConfig.publicKey,
        vapidConfig.privateKey,
      );

      this.isConfigured = true;
      this.logger.log('Web Push configured with VAPID keys');
    } catch (err) {
      this.logger.error(`Failed to configure Web Push: ${(err as Error).message}`);
      this.logger.error((err as Error).stack);
    }
  }

  /**
   * Get the VAPID public key (needed by frontend to subscribe)
   */
  async getVapidPublicKey(): Promise<string | null> {
    if (!this.settingsService) return null;
    const vapidConfig = await this.settingsService.get('vapid');
    return vapidConfig?.publicKey || null;
  }

  /**
   * Save a push subscription for a user
   */
  async subscribe(userId: string, subscription: PushSubscriptionPayload, userAgent?: string): Promise<void> {
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
      },
    });

    this.logger.log(`Push subscription saved for user ${userId}`);
  }

  /**
   * Remove a push subscription
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    this.logger.log(`Push subscription removed for user ${userId}`);
  }

  /**
   * Get all subscriptions for a user
   */
  async getSubscriptions(userId: string) {
    return prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true },
    });
  }

  /**
   * Check if a user has any push subscriptions
   */
  async hasSubscription(userId: string): Promise<boolean> {
    const count = await prisma.pushSubscription.count({ where: { userId } });
    return count > 0;
  }

  get enabled(): boolean {
    return this.isConfigured;
  }

  /**
   * Send a push notification to all of a user's subscriptions
   */
  async sendPush(userId: string, title: string, body: string, data?: Record<string, any>): Promise<number> {
    if (!this.isConfigured) {
      this.logger.debug('Push skipped — not configured');
      return 0;
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) return 0;

    const payload = JSON.stringify({
      title,
      body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { url: '/dashboard', ...data },
      timestamp: Date.now(),
    });

    let sent = 0;
    for (const sub of subscriptions) {
      try {
        const result = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        this.logger.log(`Push result for ${sub.endpoint.substring(0, 60)}: status=${result.statusCode}`);
        sent++;
      } catch (err: any) {
        // If subscription expired or invalid (410 Gone, 404), remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          this.logger.debug(`Removed expired push subscription: ${sub.endpoint.substring(0, 50)}...`);
        } else {
          this.logger.warn(`Push failed for ${sub.endpoint.substring(0, 50)}: statusCode=${err.statusCode}, message=${err.message}, body=${err.body || 'none'}`);
        }
      }
    }

    this.logger.debug(`Push sent to ${sent}/${subscriptions.length} subscriptions for user ${userId}`);
    return sent;
  }

  /**
   * Send push with full diagnostics — used by the test endpoint
   */
  async sendPushWithDiagnostics(userId: string, title: string, body: string, data?: Record<string, any>) {
    const diagnostics: any = {
      success: false,
      isConfigured: this.isConfigured,
      timestamp: new Date().toISOString(),
      subscriptions: [],
      results: [],
      vapidPublicKey: null,
    };

    // Get VAPID public key for comparison
    try {
      const vapidConfig = this.settingsService
        ? await this.settingsService.get('vapid')
        : null;
      diagnostics.vapidPublicKey = vapidConfig?.publicKey?.substring(0, 30) + '...';
    } catch {}

    if (!this.isConfigured) {
      diagnostics.error = 'Web Push not configured — VAPID keys missing or invalid';
      return diagnostics;
    }

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    diagnostics.subscriptionCount = subscriptions.length;
    if (subscriptions.length === 0) {
      diagnostics.error = 'No push subscriptions found for this user';
      diagnostics.message = 'No subscriptions found';
      return diagnostics;
    }

    const payload = JSON.stringify({
      title,
      body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { url: '/dashboard', ...data },
      timestamp: Date.now(),
    });

    let sent = 0;
    for (const sub of subscriptions) {
      const subDiag: any = {
        endpointPrefix: sub.endpoint.substring(0, 80) + '...',
        p256dhPrefix: sub.p256dh.substring(0, 20) + '...',
        createdAt: sub.createdAt,
      };

      try {
        const result = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        subDiag.status = result.statusCode;
        subDiag.headers = result.headers;
        subDiag.body = result.body;
        subDiag.success = true;
        sent++;

        this.logger.log(`Push diagnostic: status=${result.statusCode}, endpoint=${sub.endpoint.substring(0, 60)}`);
      } catch (err: any) {
        subDiag.success = false;
        subDiag.error = err.message;
        subDiag.statusCode = err.statusCode;
        subDiag.body = err.body;
        subDiag.headers = err.headers;

        this.logger.error(`Push diagnostic error: ${err.statusCode || 'unknown'} — ${err.message}`);

        if (err.statusCode === 410 || err.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          subDiag.cleaned = true;
        }
      }

      diagnostics.results.push(subDiag);
    }

    diagnostics.success = sent > 0;
    diagnostics.sent = sent;
    diagnostics.message = sent > 0 ? `Sent to ${sent} device(s)` : 'All push deliveries failed';
    return diagnostics;
  }
}

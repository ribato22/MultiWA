// MultiWA Gateway - Webhooks Service
// apps/api/src/modules/webhooks/webhooks.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { createHmac, randomBytes } from 'crypto';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

@Injectable()
export class WebhooksService {
  // Create webhook endpoint
  async create(dto: CreateWebhookDto) {
    const secret = randomBytes(32).toString('hex');
    
    return prisma.webhook.create({
      data: {
        profileId: dto.profileId,
        url: dto.url,
        events: dto.events,
        secret,
        enabled: true,
        headers: dto.headers || {},
      },
    });
  }

  // List all webhooks (optionally filter by profileId)
  async findAll(profileId?: string) {
    return prisma.webhook.findMany({
      where: profileId ? { profileId } : undefined,
      include: { profile: { select: { id: true, displayName: true } } },
    });
  }

  // Get webhook by ID
  async findOne(id: string) {
    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) throw new NotFoundException('Webhook not found');
    return webhook;
  }

  // Update webhook
  async update(id: string, dto: UpdateWebhookDto) {
    await this.findOne(id);
    return prisma.webhook.update({
      where: { id },
      data: dto,
    });
  }

  // Delete webhook
  async delete(id: string) {
    await this.findOne(id);
    await prisma.webhook.delete({ where: { id } });
    return { success: true };
  }

  // Deliver event to all matching webhooks
  async deliverEvent(profileId: string, event: string, payload: any) {
    const webhooks = await prisma.webhook.findMany({
      where: {
        profileId,
        enabled: true,
        events: { has: event },
      },
    });

    const results = await Promise.allSettled(
      webhooks.map((webhook) => this.sendWebhook(webhook, event, payload))
    );

    return results.map((result, i) => ({
      webhookId: webhooks[i].id,
      success: result.status === 'fulfilled',
      error: result.status === 'rejected' ? result.reason?.message : null,
    }));
  }

  // Send webhook with HMAC signature
  private async sendWebhook(webhook: any, event: string, payload: any) {
    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      profileId: webhook.profileId,
      data: payload,
    });

    const signature = createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MultiWA-Signature': `sha256=${signature}`,
      'X-MultiWA-Event': event,
      ...((webhook.headers as Record<string, string>) || {}),
    };

    // Rewrite localhost URLs to host.docker.internal for Docker compatibility
    // Always rewrite since the API runs inside Docker where localhost != host machine
    let targetUrl = webhook.url;
    targetUrl = targetUrl
      .replace('://localhost:', '://host.docker.internal:')
      .replace('://localhost/', '://host.docker.internal/')
      .replace('://127.0.0.1:', '://host.docker.internal:')
      .replace('://127.0.0.1/', '://host.docker.internal/');

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
    });

    // Log delivery attempt
    await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        event,
        payload: payload as any,
        statusCode: response.status,
        success: response.ok,
        response: await response.text().catch(() => null),
      },
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed: ${response.status}`);
    }

    return { success: true };
  }

  // Test webhook delivery
  async testDelivery(id: string) {
    const webhook = await this.findOne(id);
    
    const testPayload = {
      test: true,
      message: 'This is a test webhook delivery from MultiWA Gateway',
      timestamp: new Date().toISOString(),
    };

    try {
      await this.sendWebhook(webhook, 'test', testPayload);
      return { success: true, message: 'Test webhook delivered successfully' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}

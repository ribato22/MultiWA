// apps/worker/src/processors/webhook.processor.ts
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

export interface WebhookJob {
  webhookId: string;
  event: string;
  payload: any;
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateHmacSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export class WebhookProcessor {
  async process(job: Job<WebhookJob>) {
    const { webhookId, event, payload } = job.data;

    // Get webhook (schema model: Webhook)
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook || !webhook.enabled) {
      throw new Error('Webhook not found or disabled');
    }

    // Check if event is subscribed
    if (!webhook.events.includes(event) && !webhook.events.includes('*')) {
      return { skipped: true, reason: 'Event not subscribed' };
    }

    try {
      // Generate signature
      const body = JSON.stringify(payload);
      const signature = generateHmacSignature(body, webhook.secret);
      const headers = (webhook.headers as Record<string, string>) || {};

      // Send webhook
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': Date.now().toString(),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      const responseText = await response.text().catch((): null => null);

      // Log delivery (schema model: WebhookLog)
      await prisma.webhookLog.create({
        data: {
          webhookId,
          event,
          payload: payload as any,
          statusCode: response.status,
          success: response.ok,
          response: responseText,
        },
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      return { success: true, status: response.status };
    } catch (error) {
      // Log failed delivery
      await prisma.webhookLog.create({
        data: {
          webhookId,
          event,
          payload: payload as any,
          statusCode: null,
          success: false,
          response: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }
}

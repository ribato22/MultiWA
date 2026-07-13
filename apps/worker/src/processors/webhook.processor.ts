// apps/worker/src/processors/webhook.processor.ts
import { Job } from 'bullmq';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

export interface WebhookJob {
  webhookId: string;
  event: string;
  payload: any;
}

/**
 * Generate HMAC signature for the canonical webhook body.
 */
function generateHmacSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Rewrite localhost URLs to host.docker.internal so the dockerized worker can
 * reach an endpoint running on the host (matches webhooks.service.ts).
 */
function rewriteLocalhost(url: string): string {
  return url
    .replace('://localhost:', '://host.docker.internal:')
    .replace('://localhost/', '://host.docker.internal/')
    .replace('://127.0.0.1:', '://host.docker.internal:')
    .replace('://127.0.0.1/', '://host.docker.internal/');
}

/**
 * Apply the WebhookLog PII policy. WEBHOOK_LOG_PAYLOAD_MAX_BYTES:
 *   0  -> store {} (omit payload entirely)
 *   -1 -> store the full payload (no redaction)
 *   N  -> truncate common message-body fields to N characters (default 512)
 * PLN Batam internal deployments should set this to 0 (see internal runbook).
 */
function policedLogPayload(payload: any): any {
  const max = parseInt(process.env.WEBHOOK_LOG_PAYLOAD_MAX_BYTES ?? '512', 10);
  if (max === 0) return {};
  if (Number.isNaN(max) || max < 0) return payload;
  const clone = { ...(payload || {}) };
  for (const key of ['body', 'text', 'caption', 'message']) {
    if (typeof clone[key] === 'string' && clone[key].length > max) {
      clone[key] = clone[key].slice(0, max) + '…[truncated]';
    }
  }
  return clone;
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

    const logPayload = policedLogPayload(payload);

    try {
      // Canonical signed body — MUST match webhooks.service.ts so the SDK
      // verifiers (X-MultiWA-Signature) keep working.
      const body = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        profileId: webhook.profileId,
        data: payload,
      });
      const signature = generateHmacSignature(body, webhook.secret);
      const customHeaders = (webhook.headers as Record<string, string>) || {};

      const response = await fetch(rewriteLocalhost(webhook.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MultiWA-Signature': `sha256=${signature}`,
          'X-MultiWA-Event': event,
          ...customHeaders,
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
          payload: logPayload as any,
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
      // Log failed delivery (BullMQ retries the job; each attempt logs a row).
      await prisma.webhookLog.create({
        data: {
          webhookId,
          event,
          payload: logPayload as any,
          statusCode: null,
          success: false,
          response: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      throw error;
    }
  }
}

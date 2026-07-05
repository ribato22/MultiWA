// MultiWA Gateway - OTP send with delivery-confirmed failover (Send Policy Phase 3)
// apps/api/src/modules/messages/otp.service.ts
//
// Sends an OTP over the primary (unofficial) WhatsApp number and, when that path
// is unreliable, fails over to a secondary template channel (an official
// authentication-template provider). The secondary channel is fully generic and
// configured ONLY through environment variables — no provider name or credential
// lives in this repository.
//
// Failover policy (operator-approved):
//   - cold circuit OPEN (the number is known to be reach-out-locked) → go straight
//     to the fallback channel (don't waste an attempt).
//   - otherwise → send via the unofficial number, wait up to OTP_ACK_TIMEOUT_MS for
//     a delivered/read ack; if it isn't confirmed (or the send is rejected) → fail
//     over to the fallback channel.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@multiwa/database';
import { MessagesService } from './messages.service';

export interface OtpResult {
  success: boolean;
  channel: 'whatsapp' | 'fallback';
  reason?: string;
  messageId?: string;
  waMessageId?: string;
  fallbackStatus?: number;
  error?: string;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly messages: MessagesService,
    private readonly config: ConfigService,
  ) {}

  private get ackTimeoutMs(): number {
    return Number(this.config.get('OTP_ACK_TIMEOUT_MS')) || 8000;
  }

  /**
   * Send an OTP. `text` is the plain WhatsApp message for the unofficial path;
   * `code` is the value substituted into the fallback template variable.
   */
  async sendOtp(profileId: string, to: string, text: string, code: string): Promise<OtpResult> {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { coldCircuitState: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    // Circuit open → the number is reach-out-locked; skip straight to the fallback.
    if (profile.coldCircuitState === 'open') {
      this.logger.warn(`OTP for ${profileId}: cold circuit open → fallback channel`);
      return this.viaFallback(to, code, 'cold-circuit-open');
    }

    // Try the unofficial number first.
    let send: any;
    try {
      send = await this.messages.sendText({ profileId, to, text } as any);
    } catch (err: any) {
      this.logger.warn(`OTP for ${profileId}: unofficial send rejected (${err?.message}) → fallback`);
      return this.viaFallback(to, code, 'whatsapp-rejected');
    }
    // Fail over IMMEDIATELY on a synchronously-known non-delivery (soft-fail, or the
    // message was only enqueued / the profile is offline) — don't burn the ack timeout.
    // NB: reliable per-OTP confirmation assumes synchronous send mode
    // (ENGINE_HOST=api, DURABLE_SEND off); in durable mode the primary is only queued.
    if (!send?.messageId || send?.success === false || send?.status === 'failed' || send?.status === 'pending') {
      return this.viaFallback(to, code, 'whatsapp-not-sent');
    }

    // Wait for a delivered/read ack; failover if it doesn't confirm in time.
    if (await this.waitForDelivery(send.messageId, this.ackTimeoutMs)) {
      return { success: true, channel: 'whatsapp', messageId: send.messageId, waMessageId: send.waMessageId };
    }
    // Final status recheck closes the poll gap so a just-delivered OTP doesn't double-send.
    const late = await prisma.message.findUnique({ where: { id: send.messageId }, select: { status: true } });
    if (late && (late.status === 'delivered' || late.status === 'read' || late.status === 'played')) {
      return { success: true, channel: 'whatsapp', messageId: send.messageId, waMessageId: send.waMessageId };
    }
    // Best-effort recall of the primary before failover: both messages carry the same
    // code, so deleting a late-delivered copy is harmless. Non-fatal.
    if (send.waMessageId) {
      try {
        await this.messages.deleteForEveryone(profileId, to, send.waMessageId);
      } catch (e: any) {
        this.logger.warn(`OTP primary recall failed: ${e?.message}`);
      }
    }
    this.logger.warn(`OTP for ${profileId}: not confirmed within ${this.ackTimeoutMs}ms → fallback`);
    return this.viaFallback(to, code, 'whatsapp-not-delivered');
  }

  /** Poll the message row until it is delivered/read, or the timeout elapses. */
  private async waitForDelivery(messageDbId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const step = 800;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, step));
      const row = await prisma.message.findUnique({ where: { id: messageDbId }, select: { status: true } });
      if (row && (row.status === 'delivered' || row.status === 'read' || row.status === 'played')) return true;
    }
    return false;
  }

  /**
   * Extract a plain phone number (digits) for the template channel, or null when
   * the recipient is a non-phone JID (@lid / @g.us / …) that has no phone form —
   * `to.replace(/\D/g,'')` would otherwise mangle those into a bogus number.
   */
  private fallbackNumber(to: string): string | null {
    const t = to.trim();
    if (t.includes('@')) {
      if (t.endsWith('@s.whatsapp.net') || t.endsWith('@c.us')) {
        const digits = t.split('@')[0].split(':')[0].replace(/\D/g, '');
        return digits.length >= 7 ? digits : null;
      }
      return null; // @lid, @g.us, @broadcast, @newsletter — no phone number
    }
    const digits = t.replace(/\D/g, '');
    return digits.length >= 7 ? digits : null;
  }

  /**
   * Deliver the OTP via the generic template fallback channel. Endpoint,
   * credentials and template identifiers are all read from environment variables;
   * the request body mirrors a standard template-send API. An optional auth header
   * is added only when configured, so channels that authenticate via body
   * identifiers work without one.
   */
  private async viaFallback(to: string, code: string, reason: string): Promise<OtpResult> {
    const url = this.config.get<string>('OTP_FALLBACK_URL');
    if (!url) {
      this.logger.error(`OTP fallback requested (${reason}) but OTP_FALLBACK_URL is not configured`);
      return { success: false, channel: 'fallback', reason, error: 'fallback-not-configured' };
    }
    const number = this.fallbackNumber(to);
    if (!number) {
      this.logger.error(`OTP fallback (${reason}): recipient has no usable phone number`);
      return { success: false, channel: 'fallback', reason, error: 'no-phone-number' };
    }
    const varKey = this.config.get<string>('OTP_FALLBACK_VAR_KEY') || '{{1}}';
    const body = {
      company_uuid: this.config.get<string>('OTP_FALLBACK_COMPANY_UUID'),
      template_uuid: this.config.get<string>('OTP_FALLBACK_TEMPLATE_UUID'),
      chat_bot_uuid: this.config.get<string>('OTP_FALLBACK_CHATBOT_UUID'),
      contacts: [{ number, variabel: { [varKey]: code } }],
    };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const authHeader = this.config.get<string>('OTP_FALLBACK_AUTH_HEADER');
    const token = this.config.get<string>('OTP_FALLBACK_TOKEN');
    if (authHeader && token) headers[authHeader] = token;

    try {
      const timeoutMs = Number(this.config.get('OTP_FALLBACK_TIMEOUT_MS')) || 10000;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ok = res.ok;
      if (!ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        this.logger.error(`OTP fallback POST failed http=${res.status} ${detail}`);
      }
      return { success: ok, channel: 'fallback', reason, fallbackStatus: res.status };
    } catch (err: any) {
      this.logger.error(`OTP fallback POST threw: ${err?.message}`);
      return { success: false, channel: 'fallback', reason, error: err?.message ?? 'fallback-request-failed' };
    }
  }
}

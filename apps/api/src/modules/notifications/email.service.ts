// MultiWA Gateway API - Email Service
// apps/api/src/modules/notifications/email.service.ts

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private isConfigured = false;
  private fromAddress: string | undefined;

  // SettingsService is optional — injected only if SettingsModule is imported
  @Optional()
  @Inject('SETTINGS_SERVICE')
  private settingsService: any;

  async onModuleInit() {
    await this.configure();
  }

  /**
   * Configure or reconfigure the SMTP transporter.
   * Tries DB config (via SettingsService) first, then env vars.
   */
  async configure(): Promise<{ success: boolean; message: string }> {
    let host: string | undefined;
    let port: number;
    let user: string | undefined;
    let pass: string | undefined;
    let from: string | undefined;
    let secure: boolean;

    // Try to load from SettingsService (DB)
    if (this.settingsService) {
      try {
        const dbConfig = await this.settingsService.getSmtpConfig();
        if (dbConfig?.host && dbConfig?.user && dbConfig?.pass) {
          host = dbConfig.host;
          port = dbConfig.port || 587;
          user = dbConfig.user;
          pass = dbConfig.pass;
          from = dbConfig.from || dbConfig.user;
          secure = dbConfig.secure ?? (port === 465);
          this.logger.log('Loading SMTP config from database');
        }
      } catch (err) {
        this.logger.debug('Could not load SMTP config from DB, falling back to env vars');
      }
    }

    // Fall back to env vars
    if (!host || !user || !pass) {
      host = process.env.SMTP_HOST;
      port = parseInt(process.env.SMTP_PORT || '587', 10);
      user = process.env.SMTP_USER;
      pass = process.env.SMTP_PASS;
      from = process.env.SMTP_FROM || process.env.SMTP_USER;
      secure = port === 465;
    }

    if (!host || !user || !pass) {
      this.logger.warn('SMTP not configured — email notifications disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS or configure via Settings UI.');
      this.isConfigured = false;
      this.transporter = null;
      return { success: false, message: 'SMTP not configured' };
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port: port!,
        secure,
        auth: { user, pass },
      });

      await this.transporter.verify();
      this.isConfigured = true;
      this.fromAddress = from;
      this.logger.log(`SMTP configured: ${host}:${port} (user: ${user})`);
      return { success: true, message: `Connected to ${host}:${port}` };
    } catch (error) {
      this.logger.error(`SMTP configuration failed: ${(error as Error).message}`);
      this.transporter = null;
      this.isConfigured = false;
      return { success: false, message: (error as Error).message };
    }
  }

  /**
   * Reconfigure the transporter (call after updating SMTP settings in DB).
   */
  async reconfigure(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Reconfiguring SMTP transporter...');
    return this.configure();
  }

  get enabled(): boolean {
    return this.isConfigured && this.transporter !== null;
  }

  /**
   * Send an email. Returns true on success, false on failure.
   */
  async send(options: EmailOptions): Promise<boolean> {
    if (!this.transporter || !this.isConfigured) {
      this.logger.debug('Email skipped — SMTP not configured');
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html || this.buildHtml(options.subject, options.text || ''),
      });
      this.logger.debug(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Build a simple HTML email from plain text
   */
  private buildHtml(title: string, body: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px; border-radius: 12px 12px 0 0;">
    <h2 style="color: white; margin: 0;">MultiWA Gateway</h2>
  </div>
  <div style="background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <h3 style="color: #1e293b; margin-top: 0;">${title}</h3>
    <p style="color: #475569; line-height: 1.6;">${body}</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">
    <p style="color: #94a3b8; font-size: 12px;">This notification was sent from your MultiWA Gateway instance.</p>
  </div>
</body>
</html>`;
  }
}

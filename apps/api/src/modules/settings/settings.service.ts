// MultiWA Gateway API - Settings Service
// apps/api/src/modules/settings/settings.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { decrypt, encrypt } from '../../common/crypto/secret-box';

export interface StorageConfig {
  type: 'local' | 's3';
  s3Endpoint?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  s3ForcePathStyle?: boolean;
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
  secure?: boolean;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /**
   * Get a setting by key
   */
  async get<T = any>(key: string): Promise<T | null> {
    const setting = await prisma.systemSettings.findUnique({ where: { key } });
    return setting ? (setting.value as T) : null;
  }

  /**
   * Set a setting by key
   */
  async set(key: string, value: any): Promise<void> {
    await prisma.systemSettings.upsert({
      where: { key },
      update: { value, id: key },
      create: { id: key, key, value },
    });
  }

  /**
   * Get storage configuration (merged: DB overrides env vars)
   */
  async getStorageConfig(): Promise<StorageConfig> {
    const dbConfig = await this.get<any>('storage');

    // Default: check env vars
    const envConfig: StorageConfig = {
      type: process.env.S3_ENDPOINT ? 's3' : 'local',
      s3Endpoint: process.env.S3_ENDPOINT,
      s3Bucket: process.env.S3_BUCKET,
      s3Region: process.env.S3_REGION || 'us-east-1',
      s3AccessKey: process.env.S3_ACCESS_KEY,
      s3SecretKey: process.env.S3_SECRET_KEY,
    };

    if (!dbConfig) return envConfig;

    // Decrypt sensitive fields
    const config: StorageConfig = {
      type: dbConfig.type || envConfig.type,
      s3Endpoint: dbConfig.s3Endpoint || envConfig.s3Endpoint,
      s3Bucket: dbConfig.s3Bucket || envConfig.s3Bucket,
      s3Region: dbConfig.s3Region || envConfig.s3Region,
      s3ForcePathStyle: dbConfig.s3ForcePathStyle ?? true,
    };

    if (dbConfig.s3AccessKeyEnc) {
      config.s3AccessKey = decrypt(dbConfig.s3AccessKeyEnc);
    } else {
      config.s3AccessKey = envConfig.s3AccessKey;
    }

    if (dbConfig.s3SecretKeyEnc) {
      config.s3SecretKey = decrypt(dbConfig.s3SecretKeyEnc);
    } else {
      config.s3SecretKey = envConfig.s3SecretKey;
    }

    return config;
  }

  /**
   * Get storage config with secrets masked for frontend display
   */
  async getStorageConfigMasked(): Promise<StorageConfig & { source: 'env' | 'database' }> {
    const config = await this.getStorageConfig();
    const dbConfig = await this.get<any>('storage');

    return {
      ...config,
      s3AccessKey: config.s3AccessKey ? this.mask(config.s3AccessKey) : undefined,
      s3SecretKey: config.s3SecretKey ? this.mask(config.s3SecretKey) : undefined,
      source: dbConfig ? 'database' : 'env',
    };
  }

  /**
   * Update storage configuration — encrypts sensitive values
   */
  async updateStorageConfig(config: StorageConfig): Promise<void> {
    // Load existing DB config to preserve encrypted keys if masked values are sent
    const existing = await this.get<any>('storage') || {};

    const dataToStore: any = {
      type: config.type,
      s3Endpoint: config.s3Endpoint,
      s3Bucket: config.s3Bucket,
      s3Region: config.s3Region,
      s3ForcePathStyle: config.s3ForcePathStyle ?? true,
    };

    // Encrypt sensitive fields, or preserve existing encrypted values
    if (config.s3AccessKey && !config.s3AccessKey.includes('••••')) {
      dataToStore.s3AccessKeyEnc = encrypt(config.s3AccessKey);
    } else if (existing.s3AccessKeyEnc) {
      dataToStore.s3AccessKeyEnc = existing.s3AccessKeyEnc;
    }

    if (config.s3SecretKey && !config.s3SecretKey.includes('••••')) {
      dataToStore.s3SecretKeyEnc = encrypt(config.s3SecretKey);
    } else if (existing.s3SecretKeyEnc) {
      dataToStore.s3SecretKeyEnc = existing.s3SecretKeyEnc;
    }

    await this.set('storage', dataToStore);
    this.logger.log(`Storage config updated: type=${config.type}`);
  }

  /**
   * Test S3 connection with given or saved config.
   * Optionally auto-creates the bucket if it does not exist.
   */
  async testStorageConnection(
    config?: StorageConfig,
    options?: { createBucketIfMissing?: boolean },
  ): Promise<{ success: boolean; message: string; bucketMissing?: boolean; bucketCreated?: boolean }> {
    const testConfig = config || await this.getStorageConfig();

    if (testConfig.type !== 's3') {
      return { success: true, message: 'Local storage is always available' };
    }

    if (!testConfig.s3Endpoint || !testConfig.s3AccessKey || !testConfig.s3SecretKey || !testConfig.s3Bucket) {
      return { success: false, message: 'Missing required S3 configuration (endpoint, access key, secret key, bucket)' };
    }

    try {
      const { S3Client, ListBucketsCommand, HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        endpoint: testConfig.s3Endpoint,
        region: testConfig.s3Region || 'us-east-1',
        credentials: {
          accessKeyId: testConfig.s3AccessKey,
          secretAccessKey: testConfig.s3SecretKey,
        },
        forcePathStyle: testConfig.s3ForcePathStyle ?? true,
      });

      // Test 1: List buckets (validates credentials)
      await s3.send(new ListBucketsCommand({}));

      // Test 2: Check if target bucket exists
      try {
        await s3.send(new HeadBucketCommand({ Bucket: testConfig.s3Bucket }));
      } catch (bucketErr: any) {
        // Bucket doesn't exist — auto-create if requested
        if (options?.createBucketIfMissing) {
          try {
            await s3.send(new CreateBucketCommand({ Bucket: testConfig.s3Bucket }));
            this.logger.log(`Created S3 bucket: ${testConfig.s3Bucket}`);
            return {
              success: true,
              bucketCreated: true,
              message: `Bucket "${testConfig.s3Bucket}" created successfully at ${testConfig.s3Endpoint}`,
            };
          } catch (createErr: any) {
            return { success: false, message: `Failed to create bucket "${testConfig.s3Bucket}": ${createErr.message}` };
          }
        }

        return {
          success: false,
          bucketMissing: true,
          message: `Bucket "${testConfig.s3Bucket}" not found or not accessible`,
        };
      }

      return { success: true, message: `Connected to ${testConfig.s3Endpoint}, bucket "${testConfig.s3Bucket}" is accessible` };
    } catch (err: any) {
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  // ======= SMTP Configuration =======

  /**
   * Get SMTP configuration (merged: DB overrides env vars)
   */
  async getSmtpConfig(): Promise<SmtpConfig> {
    const dbConfig = await this.get<any>('smtp');

    const envConfig: SmtpConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      secure: process.env.SMTP_PORT === '465',
    };

    if (!dbConfig) return envConfig;

    const config: SmtpConfig = {
      host: dbConfig.host || envConfig.host,
      port: dbConfig.port ?? envConfig.port,
      from: dbConfig.from || envConfig.from,
      secure: dbConfig.secure ?? envConfig.secure,
    };

    config.user = dbConfig.userEnc ? decrypt(dbConfig.userEnc) : envConfig.user;
    config.pass = dbConfig.passEnc ? decrypt(dbConfig.passEnc) : envConfig.pass;

    return config;
  }

  /**
   * Get SMTP config with secrets masked for frontend display
   */
  async getSmtpConfigMasked(): Promise<SmtpConfig & { source: 'env' | 'database' | 'none' }> {
    const config = await this.getSmtpConfig();
    const dbConfig = await this.get<any>('smtp');

    const hasConfig = !!(config.host && config.user);
    return {
      ...config,
      pass: config.pass ? this.mask(config.pass) : undefined,
      source: dbConfig ? 'database' : (hasConfig ? 'env' : 'none'),
    };
  }

  /**
   * Update SMTP configuration — encrypts sensitive values
   */
  async updateSmtpConfig(config: SmtpConfig): Promise<void> {
    // Load existing DB config to preserve encrypted credentials if masked values are sent
    const existing = await this.get<any>('smtp') || {};

    const dataToStore: any = {
      host: config.host,
      port: config.port ?? 587,
      from: config.from,
      secure: config.secure ?? false,
    };

    if (config.user && !config.user.includes('••••')) {
      dataToStore.userEnc = encrypt(config.user);
    } else if (existing.userEnc) {
      dataToStore.userEnc = existing.userEnc;
    }

    if (config.pass && !config.pass.includes('••••')) {
      dataToStore.passEnc = encrypt(config.pass);
    } else if (existing.passEnc) {
      dataToStore.passEnc = existing.passEnc;
    }

    await this.set('smtp', dataToStore);
    this.logger.log(`SMTP config updated: host=${config.host}:${config.port}`);
  }

  /**
   * Test SMTP connection with given or saved config.
   * Optionally sends a test email.
   */
  async testSmtpConnection(
    config?: SmtpConfig,
    options?: { sendTestTo?: string },
  ): Promise<{ success: boolean; message: string }> {
    const testConfig = config || await this.getSmtpConfig();

    if (!testConfig.host || !testConfig.user || !testConfig.pass) {
      return { success: false, message: 'Missing required SMTP configuration (host, user, password)' };
    }

    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: testConfig.host,
        port: testConfig.port || 587,
        secure: testConfig.secure ?? (testConfig.port === 465),
        auth: {
          user: testConfig.user,
          pass: testConfig.pass,
        },
      });

      // Verify connection
      await transporter.verify();

      // Optionally send test email
      if (options?.sendTestTo) {
        await transporter.sendMail({
          from: testConfig.from || testConfig.user,
          to: options.sendTestTo,
          subject: '✅ MultiWA SMTP Test',
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:20px">
            <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:20px;border-radius:12px 12px 0 0">
              <h2 style="color:white;margin:0">✅ SMTP Configuration Verified</h2>
            </div>
            <div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
              <p>Your SMTP settings are working correctly.</p>
              <p style="color:#64748b;font-size:12px">Sent from MultiWA Gateway at ${new Date().toLocaleString()}</p>
            </div>
          </div>`,
        });
        return { success: true, message: `SMTP connected and test email sent to ${options.sendTestTo}` };
      }

      return { success: true, message: `SMTP connection to ${testConfig.host}:${testConfig.port} verified successfully` };
    } catch (err: any) {
      return { success: false, message: `SMTP connection failed: ${err.message}` };
    }
  }

  private mask(value: string): string {
    if (value.length <= 2) return '••••••';
    return value.substring(0, 2) + '••••••';
  }
}

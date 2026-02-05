// MultiWA Gateway - S3/MinIO Storage Adapter
// apps/api/src/modules/uploads/s3-storage.adapter.ts

import { Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { IStorageAdapter, UploadResult } from './storage.interface';

export class S3StorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(config: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrl?: string;
  }) {
    this.bucket = config.bucket;
    this.publicUrl = (config.publicUrl || config.endpoint).replace(/\/$/, '');

    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Required for MinIO
    });

    this.logger.log(`S3 storage initialized: ${config.endpoint}/${this.bucket}`);
  }

  async upload(buffer: Buffer, key: string, mimeType: string): Promise<UploadResult> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        ACL: 'public-read',
      }),
    );

    const url = this.getUrl(key);
    this.logger.log(`File uploaded to S3: ${url}`);

    return { url, key, size: buffer.length };
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`File deleted from S3: ${key}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete from S3: ${error.message}`);
    }
  }

  getUrl(key: string): string {
    return `${this.publicUrl}/${this.bucket}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

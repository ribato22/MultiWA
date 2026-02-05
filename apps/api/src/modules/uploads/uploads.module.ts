// MultiWA Gateway - Uploads Module (Config-driven Storage)
// apps/api/src/modules/uploads/uploads.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { STORAGE_ADAPTER } from './storage.interface';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

/**
 * Factory provider for storage adapter.
 * Reads STORAGE_TYPE from environment and creates the appropriate adapter.
 * - 'local' → LocalStorageAdapter (saves to STORAGE_PATH directory)
 * - 's3'    → S3StorageAdapter (uploads to S3/MinIO)
 */
const StorageAdapterProvider = {
  provide: STORAGE_ADAPTER,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const storageType = config.get('STORAGE_TYPE', 'local');

    if (storageType === 's3') {
      return new S3StorageAdapter({
        endpoint: config.get('S3_ENDPOINT', 'http://localhost:9000'),
        region: config.get('S3_REGION', 'ap-tiban-1'),
        accessKeyId: config.get('S3_ACCESS_KEY', 'minio'),
        secretAccessKey: config.get('S3_SECRET_KEY', 'minio123'),
        bucket: config.get('S3_BUCKET', 'multiwa-media'),
        publicUrl: config.get('S3_PUBLIC_URL'),
      });
    }

    // Default: local filesystem storage
    const storagePath = config.get('STORAGE_PATH', './media');
    const apiPort = config.get('API_PORT', '3333');
    const apiHost = config.get('API_HOST', 'localhost');
    const baseUrl = config.get('API_BASE_URL', `http://${apiHost}:${apiPort}`);

    return new LocalStorageAdapter(storagePath, baseUrl);
  },
};

@Module({
  imports: [ConfigModule],
  controllers: [UploadsController],
  providers: [StorageAdapterProvider, UploadsService],
  exports: [UploadsService, STORAGE_ADAPTER],
})
export class UploadsModule {}

// MultiWA Gateway - Local Filesystem Storage Adapter
// apps/api/src/modules/uploads/local-storage.adapter.ts

import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { IStorageAdapter, UploadResult } from './storage.interface';

export class LocalStorageAdapter implements IStorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly basePath: string;
  private readonly baseUrl: string;

  constructor(storagePath: string, apiBaseUrl: string) {
    this.basePath = resolve(storagePath);
    this.baseUrl = apiBaseUrl.replace(/\/$/, '');

    // Ensure base directory exists
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
      this.logger.log(`Created storage directory: ${this.basePath}`);
    }

    this.logger.log(`Local storage initialized: ${this.basePath}`);
  }

  async upload(buffer: Buffer, key: string, mimeType: string): Promise<UploadResult> {
    const filePath = join(this.basePath, key);
    const fileDir = dirname(filePath);

    // Ensure subdirectory exists
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }

    writeFileSync(filePath, buffer);
    this.logger.log(`File saved locally: ${filePath} (${buffer.length} bytes)`);

    return {
      url: this.getUrl(key),
      key,
      size: buffer.length,
    };
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.basePath, key);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        this.logger.log(`File deleted: ${filePath}`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to delete file: ${error.message}`);
    }
  }

  getUrl(key: string): string {
    return `${this.baseUrl}/uploads/media/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.basePath, key));
  }
}

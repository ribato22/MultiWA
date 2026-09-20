// MultiWA Gateway - Local Filesystem Storage Adapter
// apps/api/src/modules/uploads/local-storage.adapter.ts

import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
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

  async upload(buffer: Buffer, key: string, _mimeType: string): Promise<UploadResult> {
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

  /**
   * The URL the gateway hands to whatsapp-web.js and to the dashboard.
   *
   * It has to be a path this API actually serves. It previously returned
   * `<base>/uploads/media/<key>` — and `key` already begins with its folder, so
   * the URL came out as `/uploads/media/media/<uuid>`, a path nothing served.
   * `MessageMedia.fromUrl()` does not check `response.ok`, so it fetched the
   * API's own 404 JSON body and handed those bytes to WhatsApp as the image.
   *
   * `uploads/file/<key>` is served by MediaFileController.
   */
  getUrl(key: string): string {
    return `${this.baseUrl}/uploads/file/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(join(this.basePath, key));
  }

  /**
   * Read a stored object back, or null if it is not there.
   *
   * Resolves the path and refuses anything that escapes basePath, so a crafted
   * key cannot walk out of the storage directory even if a caller reaches this
   * without the route's own validation.
   */
  async read(key: string): Promise<Buffer | null> {
    const filePath = resolve(this.basePath, key);
    if (filePath !== this.basePath && !filePath.startsWith(this.basePath + sep)) {
      this.logger.warn(`Refused read outside storage root: ${key.replace(/[\r\n]/g, '')}`);
      return null;
    }
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath);
  }
}

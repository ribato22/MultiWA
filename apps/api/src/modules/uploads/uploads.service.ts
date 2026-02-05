// MultiWA Gateway - Upload Service (Adapter-based)
// apps/api/src/modules/uploads/uploads.service.ts

import { Injectable, Inject, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { STORAGE_ADAPTER, type IStorageAdapter } from './storage.interface';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(STORAGE_ADAPTER)
    private readonly storage: IStorageAdapter,
  ) {}

  /**
   * Upload a file to the configured storage backend.
   */
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder: string = 'media',
  ): Promise<{ url: string; key: string; size: number }> {
    const ext = originalName.split('.').pop() || 'bin';
    const key = `${folder}/${uuid()}.${ext}`;

    try {
      const result = await this.storage.upload(buffer, key, mimeType);
      this.logger.log(`File uploaded: ${result.url} (${result.size} bytes)`);
      return result;
    } catch (error: any) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Delete a file from storage.
   */
  async deleteFile(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  /**
   * Get public URL for a stored file.
   */
  getFileUrl(key: string): string {
    return this.storage.getUrl(key);
  }

  /**
   * Check if a file exists.
   */
  async fileExists(key: string): Promise<boolean> {
    return this.storage.exists(key);
  }

  /**
   * Determine file type from MIME type.
   */
  getFileType(mimeType: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' {
    if (mimeType.startsWith('image/')) return 'IMAGE';
    if (mimeType.startsWith('video/')) return 'VIDEO';
    if (mimeType.startsWith('audio/')) return 'AUDIO';
    return 'DOCUMENT';
  }
}

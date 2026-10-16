// MultiWA Gateway - Upload Service (Adapter-based)
// apps/api/src/modules/uploads/uploads.service.ts

import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID as uuid } from 'node:crypto';
import { STORAGE_ADAPTER, type IStorageAdapter } from './storage.interface';

/**
 * MIME type → stored file extension.
 *
 * The stored extension used to be `originalName.split('.').pop()`, taken
 * verbatim from the caller while only the MIME was validated. A genuine PNG
 * uploaded as `payload.html` was therefore stored as `<uuid>.html` — harmless
 * while nothing served those files, and an XSS vector the moment something did.
 *
 * Deriving it from the already-validated MIME removes the caller's influence
 * entirely. Anything unrecognised becomes `.bin`, which no browser executes.
 *
 * The table therefore has to cover every type the upload endpoint ACCEPTS, not
 * just the ones listed in its ALLOWED_MIMES: getFileCategory() also admits
 * anything with an image/, video/ or audio/ prefix. A type that is accepted but
 * missing here is stored as `.bin`, and `.bin` is not inert for the send path —
 * MessageMedia.fromUrl() reads the mimetype from the URL's extension and only
 * falls back to the response Content-Type when that lookup returns null
 * (MessageMedia.js:69,118). `mime.getType('.bin')` is application/octet-stream,
 * which is truthy, so the fallback never runs and the recipient gets a file
 * instead of a picture. On the S3 backend that discards the correct
 * ContentType the adapter stored on the object.
 */
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  // Phone cameras: an iPhone photo arrives as image/heic and was landing on .bin.
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

/** The extension a file of this MIME type is stored under. Never caller-controlled. */
export function extensionForMime(mimeType: string): string {
  // Strip any parameters: "audio/ogg; codecs=opus" is still audio/ogg.
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[base] ?? 'bin';
}

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
    // `originalName` is kept for logging only — it must not reach the stored key.
    const key = `${folder}/${uuid()}.${extensionForMime(mimeType)}`;

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
    // Normalised exactly as extensionForMime() does. They classify the same upload
    // for the same response, so if only one of them tolerates a parameter or an
    // uppercase type the two disagree about what was just stored.
    const mimeType_ = String(mimeType || '').split(';')[0].trim().toLowerCase();
    if (mimeType_.startsWith('image/')) return 'IMAGE';
    if (mimeType_.startsWith('video/')) return 'VIDEO';
    if (mimeType_.startsWith('audio/')) return 'AUDIO';
    return 'DOCUMENT';
  }
}

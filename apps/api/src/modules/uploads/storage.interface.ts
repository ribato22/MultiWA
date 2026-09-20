// MultiWA Gateway - Storage Adapter Interface
// apps/api/src/modules/uploads/storage.interface.ts

export interface UploadResult {
  url: string;
  key: string;
  size: number;
}

export interface IStorageAdapter {
  /**
   * Upload a file buffer to storage.
   */
  upload(
    buffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<UploadResult>;

  /**
   * Delete a file from storage by key.
   */
  delete(key: string): Promise<void>;

  /**
   * Get the public URL for a file key.
   */
  getUrl(key: string): string;

  /**
   * Check if a file exists in storage.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Read a stored object back.
   *
   * Only the local adapter implements this. S3 hands out URLs that S3 itself
   * serves, so nothing in this API ever needs to read those bytes back — the
   * route that uses this answers 404 when the adapter does not provide it.
   */
  read?(key: string): Promise<Buffer | null>;
}

export const STORAGE_ADAPTER = 'STORAGE_ADAPTER';

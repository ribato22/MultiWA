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
}

export const STORAGE_ADAPTER = 'STORAGE_ADAPTER';

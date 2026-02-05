// MultiWA Gateway - Cache Adapter Interface
// apps/api/src/modules/cache/cache.interface.ts

export interface ICacheAdapter {
  get<T = any>(key: string): Promise<T | null>;
  set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
}

export const CACHE_ADAPTER = 'CACHE_ADAPTER';

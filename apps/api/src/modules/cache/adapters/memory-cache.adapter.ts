// MultiWA Gateway - In-Memory Cache Adapter
// apps/api/src/modules/cache/adapters/memory-cache.adapter.ts

import { Logger } from '@nestjs/common';
import type { ICacheAdapter } from '../cache.interface';

interface CacheEntry<T = any> {
  value: T;
  expiresAt: number | null; // null = no expiration
}

/**
 * Simple in-memory cache using a Map with TTL eviction.
 * Zero dependencies — always available as fallback.
 */
export class MemoryCacheAdapter implements ICacheAdapter {
  private readonly logger = new Logger(MemoryCacheAdapter.name);
  private readonly store = new Map<string, CacheEntry>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Periodic cleanup of expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
    this.logger.log('In-memory cache initialized');
  }

  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check expiry
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.logger.log('Cache cleared');
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (!pattern) return allKeys;

    // Simple glob pattern (* → .*)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return allKeys.filter((k) => regex.test(k));
  }

  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.debug(`Evicted ${evicted} expired cache entries`);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

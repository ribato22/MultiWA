// MultiWA Gateway - Cache Service
// apps/api/src/modules/cache/cache.service.ts

import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_ADAPTER, type ICacheAdapter } from './cache.interface';

/**
 * Unified cache service wrapping the configured cache adapter.
 * Provides a clean API for app-wide caching with namespaced keys.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(CACHE_ADAPTER)
    private readonly adapter: ICacheAdapter,
  ) {}

  /**
   * Get a cached value by key.
   */
  async get<T = any>(key: string): Promise<T | null> {
    return this.adapter.get<T>(key);
  }

  /**
   * Set a cached value with optional TTL in seconds.
   */
  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    return this.adapter.set(key, value, ttlSeconds);
  }

  /**
   * Delete a cached key.
   */
  async del(key: string): Promise<void> {
    return this.adapter.del(key);
  }

  /**
   * Check if a key exists in cache.
   */
  async has(key: string): Promise<boolean> {
    return this.adapter.has(key);
  }

  /**
   * Get or set — returns cached value if exists, otherwise calls factory and caches the result.
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.adapter.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.adapter.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Clear entire cache.
   */
  async clear(): Promise<void> {
    return this.adapter.clear();
  }

  /**
   * Get all keys matching a pattern.
   */
  async keys(pattern?: string): Promise<string[]> {
    return this.adapter.keys(pattern);
  }

  /**
   * Invalidate all keys matching a prefix.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    const matchingKeys = await this.adapter.keys(`${prefix}*`);
    for (const key of matchingKeys) {
      await this.adapter.del(key);
    }
    if (matchingKeys.length > 0) {
      this.logger.debug(`Invalidated ${matchingKeys.length} keys with prefix: ${prefix}`);
    }
  }
}

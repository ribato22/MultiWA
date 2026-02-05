// MultiWA Gateway - Redis Cache Adapter (with Memory Fallback)
// apps/api/src/modules/cache/adapters/redis-cache.adapter.ts

import { Logger } from '@nestjs/common';
import type { ICacheAdapter } from '../cache.interface';
import { MemoryCacheAdapter } from './memory-cache.adapter';

/**
 * Redis cache adapter with automatic fallback to in-memory cache
 * if Redis is unavailable. Uses `ioredis` for connections.
 */
export class RedisCacheAdapter implements ICacheAdapter {
  private readonly logger = new Logger(RedisCacheAdapter.name);
  private redis: any = null;
  private readonly fallback: MemoryCacheAdapter;
  private isConnected = false;

  constructor(private readonly redisUrl: string) {
    this.fallback = new MemoryCacheAdapter();
    this.connectRedis();
  }

  private async connectRedis(): Promise<void> {
    try {
      // Dynamic import to avoid hard dependency on ioredis
      const Redis = (await import('ioredis')).default;
      this.redis = new Redis(this.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) {
            this.logger.warn('Redis connection failed after 3 retries, falling back to memory cache');
            this.isConnected = false;
            return null; // Stop retrying
          }
          return Math.min(times * 200, 2000);
        },
        lazyConnect: false,
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Redis connected: ${this.redisUrl}`);
      });

      this.redis.on('error', (err: Error) => {
        if (this.isConnected) {
          this.logger.warn(`Redis error: ${err.message}, falling back to memory cache`);
        }
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        this.isConnected = false;
      });
    } catch (error: any) {
      this.logger.warn(`Redis not available (${error.message}), using memory cache fallback`);
      this.isConnected = false;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isConnected) return this.fallback.get<T>(key);

    try {
      const value = await this.redis.get(key);
      if (value === null) return null;
      return JSON.parse(value) as T;
    } catch {
      return this.fallback.get<T>(key);
    }
  }

  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    // Always set in fallback for reliability
    await this.fallback.set(key, value, ttlSeconds);

    if (!this.isConnected) return;

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
    } catch {
      // Fallback already has the value
    }
  }

  async del(key: string): Promise<void> {
    await this.fallback.del(key);

    if (!this.isConnected) return;

    try {
      await this.redis.del(key);
    } catch {
      // Non-critical
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.isConnected) return this.fallback.has(key);

    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return this.fallback.has(key);
    }
  }

  async clear(): Promise<void> {
    await this.fallback.clear();

    if (!this.isConnected) return;

    try {
      await this.redis.flushdb();
      this.logger.log('Redis cache cleared');
    } catch {
      // Non-critical
    }
  }

  async keys(pattern?: string): Promise<string[]> {
    if (!this.isConnected) return this.fallback.keys(pattern);

    try {
      return await this.redis.keys(pattern || '*');
    } catch {
      return this.fallback.keys(pattern);
    }
  }
}

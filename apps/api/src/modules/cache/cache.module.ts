// MultiWA Gateway - Cache Module (Config-driven)
// apps/api/src/modules/cache/cache.module.ts

import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CACHE_ADAPTER } from './cache.interface';
import { CacheService } from './cache.service';
import { MemoryCacheAdapter } from './adapters/memory-cache.adapter';
import { RedisCacheAdapter } from './adapters/redis-cache.adapter';

/**
 * Global cache module with config-driven adapter selection.
 * - If REDIS_URL is set → uses Redis with memory fallback
 * - If no REDIS_URL     → uses pure in-memory cache
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CACHE_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get('REDIS_URL');

        if (redisUrl) {
          return new RedisCacheAdapter(redisUrl);
        }

        // Pure in-memory when no Redis configured
        return new MemoryCacheAdapter();
      },
    },
    CacheService,
  ],
  exports: [CacheService, CACHE_ADAPTER],
})
export class CacheModule {}

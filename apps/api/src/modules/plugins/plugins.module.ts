// MultiWA Gateway - Plugins Module
// apps/api/src/modules/plugins/plugins.module.ts

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PluginLoaderService } from './plugin-loader.service';

/**
 * Global plugins module.
 * Automatically loads plugins from the `plugins/` directory.
 * Plugins can subscribe to application events via the IPlugin interface.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot({
      wildcard: true,           // Allow wildcard listeners (e.g. 'message.*')
      maxListeners: 50,         // Increase for many plugins
      verboseMemoryLeak: true,  // Warn on potential leaks
    }),
  ],
  providers: [PluginLoaderService],
  exports: [PluginLoaderService],
})
export class PluginsModule {}

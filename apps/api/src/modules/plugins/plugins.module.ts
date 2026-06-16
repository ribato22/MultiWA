// MultiWA Gateway - Plugins Module
// apps/api/src/modules/plugins/plugins.module.ts

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PluginLoaderService } from './plugin-loader.service';

/**
 * Global plugins module.
 * Automatically loads plugins from the `plugins/` directory.
 * Plugins can subscribe to application events via the IPlugin interface.
 *
 * NOTE: EventEmitterModule.forRoot is registered EXACTLY ONCE, in AppModule.
 * It must NOT be registered here too — a second forRoot can create a second
 * EventEmitter2 instance, so @OnEvent listeners and PluginLoader.onAny() could
 * bind to different buses and silently drop events. PluginLoaderService consumes
 * the single globally-registered EventEmitter2.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PluginLoaderService],
  exports: [PluginLoaderService],
})
export class PluginsModule {}

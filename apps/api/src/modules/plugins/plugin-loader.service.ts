// MultiWA Gateway - Plugin Loader Service
// apps/api/src/modules/plugins/plugin-loader.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IPlugin, PluginContext } from './plugin.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PluginLoaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly plugins: Map<string, IPlugin> = new Map();
  private readonly pluginsDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.pluginsDir = this.configService.get('PLUGINS_DIR')
      || path.resolve(process.cwd(), 'plugins');
  }

  async onModuleInit() {
    await this.loadPlugins();
    this.registerEventListeners();
    this.logger.log(`Plugin system initialized: ${this.plugins.size} plugin(s) loaded`);
  }

  async onModuleDestroy() {
    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.onDestroy?.(this.createContext(name));
        this.logger.log(`Plugin destroyed: ${name}`);
      } catch (err: any) {
        this.logger.error(`Plugin ${name} destroy error: ${err.message}`);
      }
    }
  }

  /** Scan plugins directory and load each valid plugin */
  private async loadPlugins(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      this.logger.log(`Created plugins directory: ${this.pluginsDir}`);
      return;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPath = path.join(this.pluginsDir, entry.name);
      const indexFile = this.resolveEntry(pluginPath);

      if (!indexFile) {
        this.logger.warn(`Plugin ${entry.name}: no index file found, skipping`);
        continue;
      }

      try {
        // Dynamic import
        const mod = await import(indexFile);
        const plugin: IPlugin = mod.default || mod;

        if (!plugin.name || !plugin.events) {
          this.logger.warn(`Plugin ${entry.name}: missing name or events, skipping`);
          continue;
        }

        // Initialize
        const ctx = this.createContext(plugin.name);
        await plugin.onInit?.(ctx);

        this.plugins.set(plugin.name, plugin);
        this.logger.log(`Plugin loaded: ${plugin.name}@${plugin.version || '0.0.0'} (events: ${plugin.events.join(', ')})`);
      } catch (err: any) {
        this.logger.error(`Failed to load plugin ${entry.name}: ${err.message}`);
      }
    }
  }

  /** Resolve the entry file (index.ts, index.js, or main from package.json) */
  private resolveEntry(pluginDir: string): string | null {
    // Check package.json main field
    const pkgPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.main) {
          const mainPath = path.join(pluginDir, pkg.main);
          if (fs.existsSync(mainPath)) return mainPath;
        }
      } catch { /* ignore */ }
    }

    // Check common entry points
    for (const name of ['index.ts', 'index.js', 'index.mjs']) {
      const filePath = path.join(pluginDir, name);
      if (fs.existsSync(filePath)) return filePath;
    }

    return null;
  }

  /** Register the EventEmitter2 listeners that dispatch to plugins */
  private registerEventListeners(): void {
    this.eventEmitter.onAny((event: string, data: any) => {
      for (const [name, plugin] of this.plugins) {
        if (!plugin.onEvent) continue;

        const matches = plugin.events.includes('*') || plugin.events.includes(event);
        if (!matches) continue;

        // Fire-and-forget per plugin to avoid blocking the event pipeline
        Promise.resolve(plugin.onEvent(event, data, this.createContext(name))).catch(
          (err: any) => this.logger.error(`Plugin ${name} event handler error (${event}): ${err.message}`),
        );
      }
    });
  }

  /** Build a scoped PluginContext for a specific plugin */
  private createContext(pluginName: string): PluginContext {
    const logger = new Logger(`Plugin:${pluginName}`);
    return {
      logger: {
        log: (msg) => logger.log(msg),
        warn: (msg) => logger.warn(msg),
        error: (msg) => logger.error(msg),
      },
      config: {
        NODE_ENV: this.configService.get('NODE_ENV'),
        API_PORT: this.configService.get('API_PORT'),
        DATABASE_URL: undefined, // Never expose DB credentials to plugins
      },
    };
  }

  /** List loaded plugins (for admin API) */
  getLoadedPlugins(): Array<{ name: string; version: string; description?: string; events: string[] }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      events: p.events,
    }));
  }
}

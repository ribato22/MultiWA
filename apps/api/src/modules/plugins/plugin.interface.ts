// MultiWA Gateway - Plugin Interface
// apps/api/src/modules/plugins/plugin.interface.ts

/**
 * Lifecycle hooks and metadata for a MultiWA plugin.
 *
 * Plugins live in the `plugins/` directory at the project root.
 * Each plugin must export a default object conforming to this interface.
 *
 * Example (plugins/my-logger/index.ts):
 *
 *   import { IPlugin, PluginContext } from '../../apps/api/src/modules/plugins/plugin.interface';
 *
 *   const plugin: IPlugin = {
 *     name: 'my-logger',
 *     version: '1.0.0',
 *     description: 'Logs every incoming message to console',
 *     events: ['message.received'],
 *     onEvent(event, data, ctx) {
 *       ctx.logger.log(`[my-logger] ${event}: ${JSON.stringify(data).substring(0, 200)}`);
 *     },
 *   };
 *   export default plugin;
 */

export interface PluginContext {
  /** Plugin-scoped logger */
  logger: {
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  /** Read-only access to env config */
  config: Record<string, string | undefined>;
}

export interface IPlugin {
  /** Unique plugin name (kebab-case recommended) */
  name: string;
  /** SemVer version string */
  version: string;
  /** Human-readable description */
  description?: string;
  /** List of AppEvent names to subscribe to, or ['*'] for all */
  events: string[];

  /**
   * Called once when the plugin is loaded during server startup.
   * Use this for one-time initialization (e.g. open DB connections).
   */
  onInit?(ctx: PluginContext): void | Promise<void>;

  /**
   * Called when a subscribed event fires.
   */
  onEvent?(event: string, data: any, ctx: PluginContext): void | Promise<void>;

  /**
   * Called when the server is shutting down.
   * Use this for cleanup (e.g. close connections).
   */
  onDestroy?(ctx: PluginContext): void | Promise<void>;
}

// MultiWA Gateway - Engine Factory
// packages/engines/src/factory/engine-factory.ts

import type { EngineConfig, EngineType, IWhatsAppEngine } from '../types';
import { WhatsAppWebJsAdapter } from '../adapters/whatsapp-webjs.adapter';
import { BaileysAdapter } from '../adapters/baileys.adapter';
import { MockAdapter } from '../adapters/mock.adapter';

/**
 * Factory for creating WhatsApp engine instances
 * Supports hot-swapping between engines at runtime
 */
export class EngineFactory {
  private static instances = new Map<string, IWhatsAppEngine>();

  /**
   * Create a new engine instance
   */
  static create(type: EngineType): IWhatsAppEngine {
    switch (type) {
      case 'whatsapp-web-js':
        return new WhatsAppWebJsAdapter();
      case 'baileys':
        return new BaileysAdapter();
      case 'mock':
        return new MockAdapter();
      default:
        throw new Error(`Unknown engine type: ${type}`);
    }
  }

  /**
   * Get or create an engine instance for a profile
   */
  static async getOrCreate(
    profileId: string,
    type: EngineType,
    config: Omit<EngineConfig, 'profileId'>
  ): Promise<IWhatsAppEngine> {
    const existing = this.instances.get(profileId);

    if (existing) {
      // If engine type changed, destroy old and create new
      if (existing.engineType !== type) {
        await existing.destroy();
        this.instances.delete(profileId);
      } else {
        return existing;
      }
    }

    const engine = this.create(type);
    await engine.initialize({ ...config, profileId });
    this.instances.set(profileId, engine);

    return engine;
  }

  /**
   * Get an existing engine instance
   */
  static get(profileId: string): IWhatsAppEngine | undefined {
    return this.instances.get(profileId);
  }

  /**
   * Destroy an engine instance
   */
  static async destroy(profileId: string): Promise<void> {
    const engine = this.instances.get(profileId);
    if (engine) {
      await engine.destroy();
      this.instances.delete(profileId);
    }
  }

  /**
   * Destroy all engine instances
   */
  static async destroyAll(): Promise<void> {
    for (const [profileId, engine] of this.instances) {
      await engine.destroy();
    }
    this.instances.clear();
  }

  /**
   * List all active engine profiles
   */
  static listActive(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Get engine status for a profile
   */
  static getStatus(profileId: string) {
    const engine = this.instances.get(profileId);
    if (!engine) return null;

    return {
      profileId,
      engineType: engine.engineType,
      status: engine.getStatus(),
      isReady: engine.isReady(),
    };
  }

  /**
   * Get all engine statuses
   */
  static getAllStatuses() {
    return Array.from(this.instances.entries()).map(([profileId, engine]) => ({
      profileId,
      engineType: engine.engineType,
      status: engine.getStatus(),
      isReady: engine.isReady(),
    }));
  }
}

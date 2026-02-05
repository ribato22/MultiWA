"use strict";
// MultiWA Gateway - Engine Factory
// packages/engines/src/factory/engine-factory.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineFactory = void 0;
const whatsapp_webjs_adapter_1 = require("../adapters/whatsapp-webjs.adapter");
const baileys_adapter_1 = require("../adapters/baileys.adapter");
const mock_adapter_1 = require("../adapters/mock.adapter");
/**
 * Factory for creating WhatsApp engine instances
 * Supports hot-swapping between engines at runtime
 */
class EngineFactory {
    static instances = new Map();
    /**
     * Create a new engine instance
     */
    static create(type) {
        switch (type) {
            case 'whatsapp-web-js':
                return new whatsapp_webjs_adapter_1.WhatsAppWebJsAdapter();
            case 'baileys':
                return new baileys_adapter_1.BaileysAdapter();
            case 'mock':
                return new mock_adapter_1.MockAdapter();
            default:
                throw new Error(`Unknown engine type: ${type}`);
        }
    }
    /**
     * Get or create an engine instance for a profile
     */
    static async getOrCreate(profileId, type, config) {
        const existing = this.instances.get(profileId);
        if (existing) {
            // If engine type changed, destroy old and create new
            if (existing.engineType !== type) {
                await existing.destroy();
                this.instances.delete(profileId);
            }
            else {
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
    static get(profileId) {
        return this.instances.get(profileId);
    }
    /**
     * Destroy an engine instance
     */
    static async destroy(profileId) {
        const engine = this.instances.get(profileId);
        if (engine) {
            await engine.destroy();
            this.instances.delete(profileId);
        }
    }
    /**
     * Destroy all engine instances
     */
    static async destroyAll() {
        for (const [profileId, engine] of this.instances) {
            await engine.destroy();
        }
        this.instances.clear();
    }
    /**
     * List all active engine profiles
     */
    static listActive() {
        return Array.from(this.instances.keys());
    }
    /**
     * Get engine status for a profile
     */
    static getStatus(profileId) {
        const engine = this.instances.get(profileId);
        if (!engine)
            return null;
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
exports.EngineFactory = EngineFactory;
//# sourceMappingURL=engine-factory.js.map
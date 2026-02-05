import type { EngineConfig, EngineType, IWhatsAppEngine } from '../types';
/**
 * Factory for creating WhatsApp engine instances
 * Supports hot-swapping between engines at runtime
 */
export declare class EngineFactory {
    private static instances;
    /**
     * Create a new engine instance
     */
    static create(type: EngineType): IWhatsAppEngine;
    /**
     * Get or create an engine instance for a profile
     */
    static getOrCreate(profileId: string, type: EngineType, config: Omit<EngineConfig, 'profileId'>): Promise<IWhatsAppEngine>;
    /**
     * Get an existing engine instance
     */
    static get(profileId: string): IWhatsAppEngine | undefined;
    /**
     * Destroy an engine instance
     */
    static destroy(profileId: string): Promise<void>;
    /**
     * Destroy all engine instances
     */
    static destroyAll(): Promise<void>;
    /**
     * List all active engine profiles
     */
    static listActive(): string[];
    /**
     * Get engine status for a profile
     */
    static getStatus(profileId: string): {
        profileId: string;
        engineType: EngineType;
        status: import("../types").EngineStatus;
        isReady: boolean;
    } | null;
    /**
     * Get all engine statuses
     */
    static getAllStatuses(): {
        profileId: string;
        engineType: EngineType;
        status: import("../types").EngineStatus;
        isReady: boolean;
    }[];
}
//# sourceMappingURL=engine-factory.d.ts.map
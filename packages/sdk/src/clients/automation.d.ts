import type { MultiWAClient } from '../client';
import type { Automation, CreateAutomationOptions } from '../types';
export declare class AutomationClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Create a new automation
     */
    create(options: CreateAutomationOptions): Promise<Automation>;
    /**
     * List automations
     */
    list(profileId: string, options?: {
        triggerType?: string;
        isActive?: boolean;
    }): Promise<Automation[]>;
    /**
     * Get an automation by ID
     */
    get(id: string): Promise<Automation>;
    /**
     * Update an automation
     */
    update(id: string, data: Partial<CreateAutomationOptions>): Promise<Automation>;
    /**
     * Delete an automation
     */
    delete(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Toggle automation on/off
     */
    toggle(id: string): Promise<Automation>;
    /**
     * Test automation with sample message
     */
    test(id: string, message: string): Promise<{
        matches: boolean;
        matchDetails: any;
        actions: any[] | null;
    }>;
    /**
     * Get automation statistics
     */
    getStats(id: string): Promise<{
        triggerCount: number;
        lastTriggered: Date | null;
        todayCount: number;
    }>;
    /**
     * Reorder automation priorities
     */
    reorder(profileId: string, order: string[]): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=automation.d.ts.map
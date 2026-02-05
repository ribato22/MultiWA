import type { MultiWAClient } from '../client';
import type { Template, CreateTemplateOptions, PaginatedResponse } from '../types';
export declare class TemplateClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Create a new template
     */
    create(options: CreateTemplateOptions): Promise<Template>;
    /**
     * List templates
     */
    list(profileId: string, options?: {
        category?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Template>>;
    /**
     * Get a template by ID
     */
    get(id: string): Promise<Template>;
    /**
     * Update a template
     */
    update(id: string, data: Partial<CreateTemplateOptions>): Promise<Template>;
    /**
     * Delete a template
     */
    delete(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Preview template with variables
     */
    preview(id: string, variables: Record<string, string>): Promise<{
        rendered: any;
        variables: string[];
    }>;
    /**
     * Duplicate a template
     */
    duplicate(id: string, newName: string): Promise<Template>;
}
//# sourceMappingURL=templates.d.ts.map
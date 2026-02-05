import type { MultiWAClient } from '../client';
import type { Contact, CreateContactOptions, UpdateContactOptions, ImportContactsOptions, ImportCsvOptions, PaginatedResponse } from '../types';
export declare class ContactClient {
    private client;
    constructor(client: MultiWAClient);
    /**
     * Create a new contact
     */
    create(options: CreateContactOptions): Promise<Contact>;
    /**
     * List contacts with filtering
     */
    list(profileId: string, options?: {
        search?: string;
        tags?: string[];
        limit?: number;
        offset?: number;
    }): Promise<PaginatedResponse<Contact>>;
    /**
     * Get a contact by ID
     */
    get(id: string): Promise<Contact>;
    /**
     * Update a contact
     */
    update(id: string, data: UpdateContactOptions): Promise<Contact>;
    /**
     * Delete a contact
     */
    delete(id: string): Promise<{
        success: boolean;
    }>;
    /**
     * Bulk import contacts from JSON array
     */
    import(options: ImportContactsOptions): Promise<{
        created: number;
        updated: number;
        failed: number;
        errors: string[];
    }>;
    /**
     * Import contacts from CSV data
     */
    importCsv(options: ImportCsvOptions): Promise<{
        created: number;
        updated: number;
        failed: number;
        errors: string[];
    }>;
    /**
     * Export contacts to CSV
     */
    exportCsv(profileId: string, options?: {
        tags?: string[];
    }): Promise<{
        csv: string;
        count: number;
        filename: string;
    }>;
    /**
     * Add tags to a contact
     */
    addTags(id: string, tags: string[]): Promise<Contact>;
    /**
     * Remove tags from a contact
     */
    removeTags(id: string, tags: string[]): Promise<Contact>;
    /**
     * Validate a phone number
     */
    validatePhone(profileId: string, phone: string): Promise<{
        phone: string;
        validFormat: boolean;
        isIndonesian: boolean;
        onWhatsApp: boolean | null;
    }>;
    /**
     * Bulk validate phone numbers
     */
    validateBulk(profileId: string, phones: string[]): Promise<{
        total: number;
        valid: number;
        results: any[];
    }>;
}
//# sourceMappingURL=contacts.d.ts.map
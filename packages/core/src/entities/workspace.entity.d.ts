export interface WorkspaceSettings {
    timezone?: string;
    locale?: string;
}
export interface Workspace {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
    settings: WorkspaceSettings;
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateWorkspaceInput {
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
}
//# sourceMappingURL=workspace.entity.d.ts.map
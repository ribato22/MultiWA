// MultiWA Gateway Core - Workspace Entity
// packages/core/src/entities/workspace.entity.ts

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

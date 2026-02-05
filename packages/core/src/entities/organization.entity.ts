// MultiWA Gateway Core - Organization Entity
// packages/core/src/entities/organization.entity.ts

export type OrganizationPlan = 'free' | 'pro' | 'enterprise';

export interface OrganizationSettings {
  maxProfiles?: number;
  maxMessagesPerDay?: number;
  features?: string[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrganizationPlan;
  settings: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  plan?: OrganizationPlan;
}

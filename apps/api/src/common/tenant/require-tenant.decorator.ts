import { SetMetadata } from '@nestjs/common';

/**
 * Resources that ultimately belong to an Organization through
 * Profile -> Workspace -> Organization.
 */
export type TenantResource =
  | 'profile'
  | 'contact'
  | 'webhook'
  | 'conversation'
  | 'broadcast'
  | 'automation'
  | 'template'
  | 'message'
  | 'scheduledMessage'
  | 'knowledgeDocument';

export interface TenantCheck {
  /** Where to read the id from on the request. */
  from: 'body' | 'param' | 'query';
  /** The field name, e.g. 'profileId' or 'id'. */
  key: string;
  /** The resource the id refers to. */
  resource: TenantResource;
  /** When true, skip the check if the key is absent (default: required). */
  optional?: boolean;
}

export const TENANT_CHECK = 'multiwa_tenant_check';

/**
 * Declare that the route operates on tenant-scoped resource(s); the TenantGuard
 * rejects the request (403) when any referenced id does not belong to the
 * caller's organization. Closes cross-tenant IDOR/BOLA.
 *
 * @example
 * @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
 * @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
 */
export const RequireTenant = (...checks: TenantCheck[]) =>
  SetMetadata(TENANT_CHECK, checks);

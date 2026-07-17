// Tenant route-coverage meta-test (cross-tenant IDOR regression guard).
//
// The isolated tenant.guard spec proves the guard ENFORCES ownership; this test
// proves the guard is actually WIRED to every route that needs it. It reflects
// the real Nest metadata (not source scanning) and fails when:
//   1. a controller that should be tenant-scoped stops applying TenantGuard,
//   2. a route on a tenant-guarded controller has no @RequireTenant and is not
//      explicitly allowlisted as org-derived, or
//   3. a NEW controller starts using TenantGuard but isn't registered here
//      (so it never gets route-coverage checked).
//
// Adding a route without @RequireTenant to a tenant controller therefore fails
// CI unless you either add the check or justify it in the allowlist below.

import 'reflect-metadata';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PATH_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { TENANT_CHECK } from './require-tenant.decorator';
import { TenantGuard } from './tenant.guard';

import { AccountsController } from '../../modules/accounts/accounts.controller';
import { KnowledgeBaseController } from '../../modules/ai/knowledge-base.controller';
import { AutomationController } from '../../modules/automation/automation.controller';
import { AutoreplyController } from '../../modules/autoreply/autoreply.controller';
import { BroadcastController } from '../../modules/broadcast/broadcast.controller';
import { BulkController } from '../../modules/bulk/bulk.controller';
import { ContactsController } from '../../modules/contacts/contacts.controller';
import { ConversationsController } from '../../modules/conversations/conversations.controller';
import { GroupsController } from '../../modules/groups/groups.controller';
import { MessagesController } from '../../modules/messages/messages.controller';
import { ProfilesController } from '../../modules/profiles/profiles.controller';
import { RbacController } from '../../modules/rbac/rbac.controller';
import { StatisticsController } from '../../modules/statistics/statistics.controller';
import { TemplatesController } from '../../modules/templates/templates.controller';
import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { WorkspacesController } from '../../modules/workspaces/workspaces.controller';

const TENANT_CONTROLLERS = [
  AccountsController, KnowledgeBaseController, AutomationController, AutoreplyController,
  BroadcastController, BulkController, ContactsController, ConversationsController,
  GroupsController, MessagesController, ProfilesController, RbacController,
  StatisticsController, TemplatesController, WebhooksController, WorkspacesController,
];

// Routes that legitimately scope by the caller's org (req.user.organizationId)
// with no client-supplied resource id, so they need no @RequireTenant. Keyed
// "Controller.method". Every entry has been individually reviewed as org-derived.
const ORG_DERIVED_ALLOWLIST = new Set<string>([
  'AccountsController.findAll',
  'AccountsController.create',
  'ProfilesController.findAll',
  'ProfilesController.create',
  'WorkspacesController.findAll',
  'WorkspacesController.create',
  'ConversationsController.unreadCount',
  'StatisticsController.getDashboard',
  // RbacController derives org from the token and never trusts client-supplied
  // ids (see the controller header) — every route is org-scoped internally.
  'RbacController.getPermissions',
  'RbacController.createRole',
  'RbacController.listRoles',
  'RbacController.removeRole',
  'RbacController.getUserRoles',
  'RbacController.getUserPermissions',
  'RbacController.seedRoles',
]);

function hasTenantGuard(Ctrl: any): boolean {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, Ctrl) || []) as any[];
  return guards.some((g) => g === TenantGuard || g?.name === 'TenantGuard');
}

describe('tenant route coverage (IDOR regression guard)', () => {
  it('registers every controller that applies TenantGuard', () => {
    // Discover controller files that reference TenantGuard, so a new one can't be
    // added without also being covered by this test.
    const modulesDir = path.resolve(__dirname, '../../modules');
    const referencing: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.controller.ts') && readFileSync(p, 'utf8').includes('TenantGuard')) {
          referencing.push(entry.name);
        }
      }
    };
    walk(modulesDir);
    expect(referencing.length).toBe(TENANT_CONTROLLERS.length);
  });

  it('every registered controller actually applies TenantGuard', () => {
    for (const Ctrl of TENANT_CONTROLLERS) {
      expect(hasTenantGuard(Ctrl), `${Ctrl.name} must apply TenantGuard`).toBe(true);
    }
  });

  it('every route on a tenant-guarded controller has @RequireTenant or is allowlisted', () => {
    const violations: string[] = [];
    for (const Ctrl of TENANT_CONTROLLERS) {
      const proto: any = Ctrl.prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue; // not a route
        const protectedRoute = Reflect.getMetadata(TENANT_CHECK, handler) !== undefined;
        const key = `${Ctrl.name}.${name}`;
        if (!protectedRoute && !ORG_DERIVED_ALLOWLIST.has(key)) {
          violations.push(key);
        }
      }
    }
    expect(violations, `Tenant routes missing @RequireTenant (add the check or allowlist as org-derived):\n  ${violations.join('\n  ')}`).toEqual([]);
  });
});

// MultiWA Gateway API - the role classes
// apps/api/src/modules/auth/roles.ts
//
// Who may call a route, by organization role. Every route that changes something names one with @Roles(...); the
// role meta-test (role-route-coverage.spec.ts) holds each route to scripts/api-roles.snapshot.json.

/** Every signed-in role: self-service and reads. */
export const ANY_ROLES: readonly string[] = ['owner', 'admin', 'member', 'viewer'];

/** The roles that do the daily work: sending, chats, calls, contacts. */
export const AGENT_ROLES: readonly string[] = ['owner', 'admin', 'member'];

/** The roles that configure: profiles, broadcasts, automation, webhooks, templates, the team. */
export const ADMIN_ROLES: readonly string[] = ['owner', 'admin'];

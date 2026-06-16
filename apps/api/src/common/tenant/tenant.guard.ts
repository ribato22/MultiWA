import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { prisma } from '@multiwa/database';
import {
  TENANT_CHECK,
  TenantCheck,
  TenantResource,
} from './require-tenant.decorator';

/**
 * Enforces tenant ownership for routes annotated with @RequireTenant.
 * Must run AFTER the auth guard (so req.user is populated) — register it at the
 * controller/route level alongside the auth guard:
 *   @UseGuards(JwtOrApiKeyGuard, TenantGuard)
 * Routes without @RequireTenant pass through untouched.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const checks = this.reflector.getAllAndOverride<TenantCheck[]>(TENANT_CHECK, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!checks || checks.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization context');
    }

    for (const check of checks) {
      const bag =
        check.from === 'body'
          ? req.body
          : check.from === 'param'
            ? req.params
            : req.query;
      const id = bag?.[check.key];

      if (id === undefined || id === null || id === '') {
        if (check.optional) continue;
        throw new ForbiddenException(`Missing ${check.key}`);
      }

      const owned = await this.belongsToOrg(check.resource, String(id), organizationId);
      if (!owned) {
        // Use a generic message so existence isn't leaked across tenants.
        throw new ForbiddenException('Resource not found in your organization');
      }
    }
    return true;
  }

  private async belongsToOrg(
    resource: TenantResource,
    id: string,
    organizationId: string,
  ): Promise<boolean> {
    // Most tenant resources chain to the org through their profile's workspace.
    const viaProfile = { profile: { workspace: { organizationId } } } as const;
    const select = { id: true } as const;

    switch (resource) {
      // --- Resources that scope to the org directly (higher in the tree) ---
      case 'workspace':
        return !!(await prisma.workspace.findFirst({ where: { id, organizationId }, select }));
      case 'account':
        return !!(await prisma.account.findFirst({
          where: { id, workspace: { organizationId } },
          select,
        }));
      case 'role':
        return !!(await prisma.role.findFirst({ where: { id, organizationId }, select }));

      // --- Resources that chain through Profile -> Workspace -> Organization ---
      case 'profile':
        return !!(await prisma.profile.findFirst({
          where: { id, workspace: { organizationId } },
          select,
        }));
      case 'contact':
        return !!(await prisma.contact.findFirst({ where: { id, ...viaProfile }, select }));
      case 'webhook':
        return !!(await prisma.webhook.findFirst({ where: { id, ...viaProfile }, select }));
      case 'conversation':
        return !!(await prisma.conversation.findFirst({ where: { id, ...viaProfile }, select }));
      case 'broadcast':
        return !!(await prisma.broadcast.findFirst({ where: { id, ...viaProfile }, select }));
      case 'automation':
        return !!(await prisma.automation.findFirst({ where: { id, ...viaProfile }, select }));
      case 'template':
        return !!(await prisma.template.findFirst({ where: { id, ...viaProfile }, select }));
      case 'message':
        return !!(await prisma.message.findFirst({ where: { id, ...viaProfile }, select }));
      case 'scheduledMessage':
        return !!(await prisma.scheduledMessage.findFirst({ where: { id, ...viaProfile }, select }));
      case 'knowledgeDocument':
        return !!(await prisma.knowledgeDocument.findFirst({ where: { id, ...viaProfile }, select }));
      default:
        return false;
    }
  }
}

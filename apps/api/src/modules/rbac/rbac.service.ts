// MultiWA Gateway - RBAC Service
// apps/api/src/modules/rbac/rbac.service.ts

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto';

// Built-in permissions
export const PERMISSIONS = {
  // Organization
  'org:read': 'View organization details',
  'org:update': 'Update organization settings',
  'org:delete': 'Delete organization',
  'org:billing': 'Manage billing',

  // Workspace
  'workspace:create': 'Create workspaces',
  'workspace:read': 'View workspaces',
  'workspace:update': 'Update workspaces',
  'workspace:delete': 'Delete workspaces',

  // Profiles (WhatsApp accounts)
  'profile:create': 'Create WhatsApp profiles',
  'profile:read': 'View profiles',
  'profile:update': 'Update profiles',
  'profile:delete': 'Delete profiles',
  'profile:connect': 'Connect/disconnect WhatsApp',

  // Messages
  'message:send': 'Send messages',
  'message:read': 'Read message history',
  'message:delete': 'Delete messages',

  // Contacts
  'contact:create': 'Create contacts',
  'contact:read': 'View contacts',
  'contact:update': 'Update contacts',
  'contact:delete': 'Delete contacts',
  'contact:import': 'Import contacts',
  'contact:export': 'Export contacts',

  // Templates
  'template:create': 'Create templates',
  'template:read': 'View templates',
  'template:update': 'Update templates',
  'template:delete': 'Delete templates',

  // Broadcast
  'broadcast:create': 'Create broadcasts',
  'broadcast:read': 'View broadcasts',
  'broadcast:execute': 'Start/pause broadcasts',
  'broadcast:delete': 'Delete broadcasts',

  // Automation
  'automation:create': 'Create automations',
  'automation:read': 'View automations',
  'automation:update': 'Update automations',
  'automation:delete': 'Delete automations',

  // Users & Roles
  'user:invite': 'Invite users',
  'user:read': 'View users',
  'user:update': 'Update users',
  'user:remove': 'Remove users',
  'role:manage': 'Manage roles',

  // API Keys
  'apikey:create': 'Create API keys',
  'apikey:read': 'View API keys',
  'apikey:delete': 'Revoke API keys',

  // Webhooks
  'webhook:manage': 'Manage webhooks',

  // Audit
  'audit:read': 'View audit logs',

  // Settings
  'settings:read': 'View settings',
  'settings:update': 'Update settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;

// Built-in roles
export const DEFAULT_ROLES = {
  owner: {
    name: 'Owner',
    description: 'Full access to everything',
    permissions: Object.keys(PERMISSIONS) as Permission[],
    isSystem: true,
  },
  admin: {
    name: 'Admin',
    description: 'Administrative access',
    permissions: Object.keys(PERMISSIONS).filter(p => 
      !['org:delete', 'org:billing', 'role:manage'].includes(p)
    ) as Permission[],
    isSystem: true,
  },
  manager: {
    name: 'Manager',
    description: 'Manage profiles and messaging',
    permissions: [
      'workspace:read', 'profile:read', 'profile:update', 'profile:connect',
      'message:send', 'message:read',
      'contact:create', 'contact:read', 'contact:update', 'contact:import', 'contact:export',
      'template:create', 'template:read', 'template:update',
      'broadcast:create', 'broadcast:read', 'broadcast:execute',
      'automation:read', 'automation:update',
      'settings:read',
    ] as Permission[],
    isSystem: true,
  },
  operator: {
    name: 'Operator',
    description: 'Send messages and manage contacts',
    permissions: [
      'workspace:read', 'profile:read',
      'message:send', 'message:read',
      'contact:create', 'contact:read', 'contact:update',
      'template:read',
      'broadcast:read',
    ] as Permission[],
    isSystem: true,
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access',
    permissions: [
      'workspace:read', 'profile:read',
      'message:read', 'contact:read', 'template:read',
      'broadcast:read', 'automation:read',
    ] as Permission[],
    isSystem: true,
  },
};

@Injectable()
export class RbacService {
  // ============================================
  // Roles CRUD
  // ============================================

  async createRole(dto: CreateRoleDto) {
    // Check for duplicate name
    const existing = await prisma.role.findFirst({
      where: { organizationId: dto.organizationId, name: dto.name },
    });
    if (existing) throw new BadRequestException('Role name already exists');

    // Validate permissions
    const invalidPerms = dto.permissions.filter(p => !(p in PERMISSIONS));
    if (invalidPerms.length > 0) {
      throw new BadRequestException(`Invalid permissions: ${invalidPerms.join(', ')}`);
    }

    return prisma.role.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        description: dto.description,
        permissions: dto.permissions,
        isSystem: false,
      },
    });
  }

  async listRoles(organizationId: string) {
    return prisma.role.findMany({
      where: { organizationId },
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  async getRole(id: string) {
    const role = await prisma.role.findUnique({
      where: { id },
      include: { users: { include: { user: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.getRole(id);
    if (role.isSystem) throw new BadRequestException('Cannot modify system role');

    if (dto.permissions) {
      const invalidPerms = dto.permissions.filter(p => !(p in PERMISSIONS));
      if (invalidPerms.length > 0) {
        throw new BadRequestException(`Invalid permissions: ${invalidPerms.join(', ')}`);
      }
    }

    return prisma.role.update({
      where: { id },
      data: dto,
    });
  }

  async deleteRole(id: string) {
    const role = await this.getRole(id);
    if (role.isSystem) throw new BadRequestException('Cannot delete system role');
    if (role.users.length > 0) throw new BadRequestException('Remove all users from this role first');

    await prisma.role.delete({ where: { id } });
    return { success: true };
  }

  // ============================================
  // Role Assignment
  // ============================================

  async assignRole(dto: AssignRoleDto) {
    // Verify role exists
    const role = await prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundException('Role not found');

    // Check if already assigned
    const existing = await prisma.userRole.findUnique({
      where: {
        userId_organizationId: {
          userId: dto.userId,
          organizationId: role.organizationId,
        },
      },
    });

    if (existing) {
      // Update existing assignment
      return prisma.userRole.update({
        where: { id: existing.id },
        data: { roleId: dto.roleId },
      });
    }

    // Create new assignment
    return prisma.userRole.create({
      data: {
        userId: dto.userId,
        roleId: dto.roleId,
        organizationId: role.organizationId,
      },
    });
  }

  async removeRole(userId: string, organizationId: string) {
    await prisma.userRole.deleteMany({
      where: { userId, organizationId },
    });
    return { success: true };
  }

  async getUserRoles(userId: string) {
    return prisma.userRole.findMany({
      where: { userId },
      include: { role: true, organization: true },
    });
  }

  // ============================================
  // Permission Checks
  // ============================================

  async hasPermission(userId: string, organizationId: string, permission: Permission): Promise<boolean> {
    const userRole = await prisma.userRole.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });

    if (!userRole) return false;
    const permissions = userRole.role.permissions as string[];
    return permissions.includes(permission);
  }

  async hasAnyPermission(userId: string, organizationId: string, permissions: Permission[]): Promise<boolean> {
    const userRole = await prisma.userRole.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });

    if (!userRole) return false;
    const rolePerms = userRole.role.permissions as string[];
    return permissions.some(p => rolePerms.includes(p));
  }

  async hasAllPermissions(userId: string, organizationId: string, permissions: Permission[]): Promise<boolean> {
    const userRole = await prisma.userRole.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });

    if (!userRole) return false;
    const rolePerms = userRole.role.permissions as string[];
    return permissions.every(p => rolePerms.includes(p));
  }

  async getUserPermissions(userId: string, organizationId: string): Promise<string[]> {
    const userRole = await prisma.userRole.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });

    if (!userRole) return [];
    return userRole.role.permissions as string[];
  }

  // ============================================
  // Seed default roles
  // ============================================

  async seedDefaultRoles(organizationId: string) {
    for (const [key, role] of Object.entries(DEFAULT_ROLES)) {
      const existing = await prisma.role.findFirst({
        where: { organizationId, name: role.name },
      });

      if (!existing) {
        await prisma.role.create({
          data: {
            organizationId,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            isSystem: role.isSystem,
          },
        });
      }
    }
  }

  // List all available permissions
  getPermissions() {
    return Object.entries(PERMISSIONS).map(([key, description]) => ({
      key,
      description,
      category: key.split(':')[0],
    }));
  }
}

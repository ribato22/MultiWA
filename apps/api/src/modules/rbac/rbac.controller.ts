// MultiWA Gateway - RBAC Controller
// apps/api/src/modules/rbac/rbac.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { RbacService } from './rbac.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto';

// RBAC is the privilege boundary itself, so the organization is ALWAYS derived
// from the authenticated principal (req.user.organizationId) — never trusted from
// a client-supplied query/body/param. Role ids are tenant-checked against the
// caller's org so one tenant cannot read/modify/assign another tenant's roles.
@ApiTags('RBAC')
@Controller('rbac')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class RbacController {
  constructor(private readonly service: RbacService) {}

  // Permissions list
  @Get('permissions')
  @ApiOperation({ summary: 'List all available permissions' })
  getPermissions() {
    return this.service.getPermissions();
  }

  // Roles CRUD
  @Post('roles')
  @ApiOperation({ summary: 'Create custom role' })
  @ApiValidationError()
  async createRole(@Request() req: any, @Body() dto: CreateRoleDto) {
    // Authoritative org from the token — ignore any client-supplied organizationId.
    dto.organizationId = req.user.organizationId;
    return this.service.createRole(dto);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List roles for the caller organization' })
  async listRoles(@Request() req: any) {
    return this.service.listRoles(req.user.organizationId);
  }

  @Get('roles/:id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'role' })
  @ApiOperation({ summary: 'Get role details with users' })
  @ApiNotFound('Role')
  async getRole(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Put('roles/:id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'role' })
  @ApiOperation({ summary: 'Update role' })
  @ApiValidationError()
  @ApiNotFound('Role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.service.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'role' })
  @ApiOperation({ summary: 'Delete custom role' })
  @ApiNotFound('Role')
  async deleteRole(@Param('id') id: string) {
    return this.service.deleteRole(id);
  }

  // Role assignment
  @Post('assign')
  @RequireTenant({ from: 'body', key: 'roleId', resource: 'role' })
  @ApiOperation({ summary: 'Assign role to user' })
  @ApiValidationError()
  @ApiNotFound('Role')
  async assignRole(@Body() dto: AssignRoleDto) {
    return this.service.assignRole(dto);
  }

  @Delete('users/:userId/organizations/:orgId')
  @ApiOperation({ summary: 'Remove user from the caller organization' })
  @ApiNotFound('User')
  async removeRole(@Param('userId') userId: string, @Request() req: any) {
    // Org is taken from the token; the :orgId path segment is not trusted.
    return this.service.removeRole(userId, req.user.organizationId);
  }

  @Get('users/:userId/roles')
  @ApiOperation({ summary: 'Get the user roles within the caller organization' })
  @ApiNotFound('User')
  async getUserRoles(@Param('userId') userId: string, @Request() req: any) {
    return this.service.getUserRoles(userId, req.user.organizationId);
  }

  @Get('users/:userId/permissions')
  @ApiOperation({ summary: 'Get user permissions for the caller organization' })
  @ApiNotFound('User')
  async getUserPermissions(@Param('userId') userId: string, @Request() req: any) {
    return this.service.getUserPermissions(userId, req.user.organizationId);
  }

  @Post('organizations/:id/seed')
  @ApiOperation({ summary: 'Seed default roles for the caller organization' })
  async seedRoles(@Request() req: any) {
    // Always seed the caller's own org; the :id path segment is not trusted.
    await this.service.seedDefaultRoles(req.user.organizationId);
    return { success: true };
  }
}

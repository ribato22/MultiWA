// MultiWA Gateway - RBAC Controller
// apps/api/src/modules/rbac/rbac.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { RbacService } from './rbac.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateRoleDto, UpdateRoleDto, AssignRoleDto } from './dto';

@ApiTags('RBAC')
@Controller('rbac')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
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
  async createRole(@Body() dto: CreateRoleDto) {
    return this.service.createRole(dto);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List roles for organization' })
  @ApiQuery({ name: 'organizationId', required: true })
  async listRoles(@Query('organizationId') organizationId: string) {
    return this.service.listRoles(organizationId);
  }

  @Get('roles/:id')
  @ApiOperation({ summary: 'Get role details with users' })
  async getRole(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Put('roles/:id')
  @ApiOperation({ summary: 'Update role' })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.service.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'Delete custom role' })
  async deleteRole(@Param('id') id: string) {
    return this.service.deleteRole(id);
  }

  // Role assignment
  @Post('assign')
  @ApiOperation({ summary: 'Assign role to user' })
  async assignRole(@Body() dto: AssignRoleDto) {
    return this.service.assignRole(dto);
  }

  @Delete('users/:userId/organizations/:orgId')
  @ApiOperation({ summary: 'Remove user from organization' })
  async removeRole(
    @Param('userId') userId: string,
    @Param('orgId') organizationId: string,
  ) {
    return this.service.removeRole(userId, organizationId);
  }

  @Get('users/:userId/roles')
  @ApiOperation({ summary: 'Get all roles for a user' })
  async getUserRoles(@Param('userId') userId: string) {
    return this.service.getUserRoles(userId);
  }

  @Get('users/:userId/permissions')
  @ApiOperation({ summary: 'Get user permissions for organization' })
  @ApiQuery({ name: 'organizationId', required: true })
  async getUserPermissions(
    @Param('userId') userId: string,
    @Query('organizationId') organizationId: string,
  ) {
    return this.service.getUserPermissions(userId, organizationId);
  }

  @Post('organizations/:id/seed')
  @ApiOperation({ summary: 'Seed default roles for organization' })
  async seedRoles(@Param('id') organizationId: string) {
    await this.service.seedDefaultRoles(organizationId);
    return { success: true };
  }
}

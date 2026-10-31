// apps/api/src/modules/workspaces/workspaces.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto';

@ApiTags('Workspaces')
@Controller('workspaces')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List workspaces' })
  async findAll(@Request() req: any) {
    return this.service.findAll(req.user.organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create workspace' })
  @ApiValidationError()
  async create(@Request() req: any, @Body() dto: CreateWorkspaceDto) {
    return this.service.create(req.user.organizationId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get workspace by ID' })
  @RequireTenant({ from: 'param', key: 'id', resource: 'workspace' })
  @ApiNotFound('Workspace')
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update workspace' })
  @RequireTenant({ from: 'param', key: 'id', resource: 'workspace' })
  @ApiValidationError()
  @ApiNotFound('Workspace')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.service.update(id, dto);
  }

  // Deleting a workspace deletes its profiles and their recordings (the cascade, then the nightly sweep), which only an
  // owner or admin may: so an owner or admin only. Logins only (JwtAuthGuard): no API key reaches it, so no scope.
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Delete workspace' })
  @RequireTenant({ from: 'param', key: 'id', resource: 'workspace' })
  @ApiNotFound('Workspace')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

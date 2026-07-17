// apps/api/src/modules/organizations/organizations.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiForbiddenResponse } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { UpdateOrganizationDto, AddMemberDto, UpdateMemberRoleDto } from './dto';

@ApiTags('Organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current organization' })
  async getCurrent(@Request() req: any) {
    return this.service.findById(req.user.organizationId);
  }

  @Put('current')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Update current organization' })
  @ApiForbiddenResponse({ description: 'Requires owner or admin role' })
  @ApiValidationError()
  async update(@Request() req: any, @Body() dto: UpdateOrganizationDto) {
    return this.service.update(req.user.organizationId, dto);
  }

  // ── Member Management ──

  @Get('members')
  @ApiOperation({ summary: 'List organization members' })
  async listMembers(@Request() req: any) {
    return this.service.listMembers(req.user.organizationId);
  }

  @Post('members')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Invite/create a new member' })
  @ApiForbiddenResponse({ description: 'Requires owner or admin role' })
  @ApiValidationError()
  async addMember(@Request() req: any, @Body() dto: AddMemberDto) {
    return this.service.addMember(req.user.organizationId, dto);
  }

  @Put('members/:id/role')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Update member role' })
  @ApiForbiddenResponse({ description: 'Requires owner or admin role' })
  @ApiValidationError()
  @ApiNotFound('Member')
  async updateMemberRole(
    @Request() req: any,
    @Param('id') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.service.updateMemberRole(req.user.organizationId, memberId, dto.role);
  }

  @Delete('members/:id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Remove member from organization' })
  @ApiForbiddenResponse({ description: 'Requires owner or admin role' })
  @ApiNotFound('Member')
  async removeMember(@Request() req: any, @Param('id') memberId: string) {
    return this.service.removeMember(req.user.organizationId, req.user.id, memberId);
  }
}

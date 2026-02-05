// apps/api/src/modules/organizations/organizations.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get current organization' })
  async getCurrent(@Request() req: any) {
    return this.service.findById(req.user.organizationId);
  }

  @Put('current')
  @ApiOperation({ summary: 'Update current organization' })
  async update(@Request() req: any, @Body() dto: any) {
    return this.service.update(req.user.organizationId, dto);
  }

  // ── Member Management ──

  @Get('members')
  @ApiOperation({ summary: 'List organization members' })
  async listMembers(@Request() req: any) {
    return this.service.listMembers(req.user.organizationId);
  }

  @Post('members')
  @ApiOperation({ summary: 'Invite/create a new member' })
  async addMember(@Request() req: any, @Body() dto: { email: string; name: string; role?: string }) {
    return this.service.addMember(req.user.organizationId, dto);
  }

  @Put('members/:id/role')
  @ApiOperation({ summary: 'Update member role' })
  async updateMemberRole(
    @Request() req: any,
    @Param('id') memberId: string,
    @Body() dto: { role: string },
  ) {
    return this.service.updateMemberRole(req.user.organizationId, memberId, dto.role);
  }

  @Delete('members/:id')
  @ApiOperation({ summary: 'Remove member from organization' })
  async removeMember(@Request() req: any, @Param('id') memberId: string) {
    return this.service.removeMember(req.user.organizationId, req.user.id, memberId);
  }
}

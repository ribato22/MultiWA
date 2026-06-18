// MultiWA Gateway API - Profiles Controller
// apps/api/src/modules/profiles/profiles.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('Profiles')
@Controller('profiles')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'List all profiles in workspace' })
  @ApiResponse({ status: 200, description: 'List of profiles' })
  async findAll(@Request() req: any, @Query('workspaceId') workspaceId?: string) {
    return this.profilesService.findAll(req.user.organizationId, workspaceId);
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Get profile by ID' })
  @ApiResponse({ status: 200, description: 'Profile details' })
  @ApiNotFound('Profile')
  async findOne(@Param('id') id: string) {
    return this.profilesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new WhatsApp profile' })
  @ApiResponse({ status: 201, description: 'Profile created' })
  @ApiValidationError()
  async create(@Body() dto: CreateProfileDto, @Request() req: any) {
    return this.profilesService.create(dto, req.user);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Update profile' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async update(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profilesService.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Delete profile' })
  @ApiResponse({ status: 200, description: 'Profile deleted' })
  @ApiNotFound('Profile')
  async delete(@Param('id') id: string) {
    return this.profilesService.delete(id);
  }

  // WhatsApp Connection
  @Post(':id/connect')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Connect WhatsApp profile (QR code sent via WebSocket)' })
  @ApiResponse({ status: 200, description: 'Connection initiated - listen on WebSocket /ws namespace for qr:update event' })
  @ApiNotFound('Profile')
  async connect(@Param('id') id: string) {
    return this.profilesService.connect(id);
  }

  @Post(':id/disconnect')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Disconnect WhatsApp profile' })
  @ApiResponse({ status: 200, description: 'Disconnected' })
  @ApiNotFound('Profile')
  async disconnect(@Param('id') id: string) {
    return this.profilesService.disconnect(id);
  }

  // Note: QR code is now delivered via WebSocket (/ws namespace, 'qr:update' event)
  // SSE endpoint removed in favor of WebSocket for real-time updates

  @Get(':id/status')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Get connection status' })
  @ApiResponse({ status: 200, description: 'Connection status' })
  @ApiNotFound('Profile')
  async status(@Param('id') id: string) {
    return this.profilesService.getStatus(id);
  }
}

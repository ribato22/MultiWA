// MultiWA Gateway API - Accounts Controller
// apps/api/src/modules/accounts/accounts.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { AccountsService } from './accounts.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ADMIN_ROLES } from '../auth/roles';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateAccountDto, UpdateAccountDto, CreateProfileDto } from './dto';

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all accounts for user' })
  async findAll(@Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    return this.accountsService.findAll(userId);
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'account' })
  @ApiOperation({ summary: 'Get account by ID' })
  @ApiNotFound('Account')
  async findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Post()
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Create new account' })
  @ApiValidationError()
  async create(@Body() dto: CreateAccountDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    return this.accountsService.create(dto, userId);
  }

  @Put(':id')
  @Roles(...ADMIN_ROLES)
  @RequireTenant({ from: 'param', key: 'id', resource: 'account' })
  @ApiOperation({ summary: 'Update account' })
  @ApiValidationError()
  @ApiNotFound('Account')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @RequireTenant({ from: 'param', key: 'id', resource: 'account' })
  @ApiOperation({ summary: 'Delete account' })
  @ApiNotFound('Account')
  async remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }

  // Nested profiles endpoints. Both the account and the profile are tenant-checked
  // so a caller can't pair their own account id with another org's profile id.
  @Get(':accountId/profiles')
  @RequireScope('profiles:read')
  @RequireTenant({ from: 'param', key: 'accountId', resource: 'account' })
  @ApiOperation({ summary: 'Get all profiles for account' })
  @ApiNotFound('Account')
  async getProfiles(@Param('accountId') accountId: string) {
    return this.accountsService.getProfiles(accountId);
  }

  @Post(':accountId/profiles')
  @Roles(...ADMIN_ROLES)
  @RequireScope('profiles:write')
  @RequireTenant({ from: 'param', key: 'accountId', resource: 'account' })
  @ApiOperation({ summary: 'Create profile for account' })
  @ApiValidationError()
  @ApiNotFound('Account')
  async createProfile(
    @Param('accountId') accountId: string,
    @Body() dto: CreateProfileDto,
  ) {
    return this.accountsService.createProfile(accountId, dto);
  }

  @Get(':accountId/profiles/:profileId')
  @RequireScope('profiles:read')
  @RequireTenant(
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  )
  @ApiOperation({ summary: 'Get profile by ID' })
  @ApiNotFound('Profile')
  async getProfile(
    @Param('accountId') accountId: string,
    @Param('profileId') profileId: string,
  ) {
    return this.accountsService.getProfile(accountId, profileId);
  }

  // As the flat route: deleting a profile deletes every recording file of it, so an owner or admin only, and an API
  // key with a scope list needs profiles:write.
  @Delete(':accountId/profiles/:profileId')
  @Roles('owner', 'admin')
  @RequireScope('profiles:write')
  @RequireTenant(
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  )
  @ApiOperation({ summary: 'Delete profile' })
  @ApiNotFound('Profile')
  async deleteProfile(
    @Param('accountId') accountId: string,
    @Param('profileId') profileId: string,
  ) {
    return this.accountsService.deleteProfile(accountId, profileId);
  }

  @Post(':accountId/profiles/:profileId/connect')
  @Roles(...ADMIN_ROLES)
  @RequireScope('profiles:write')
  @RequireTenant(
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  )
  @ApiOperation({ summary: 'Connect profile (start QR)' })
  async connectProfile(
    @Param('accountId') accountId: string,
    @Param('profileId') profileId: string,
  ) {
    return this.accountsService.connectProfile(accountId, profileId);
  }

  @Post(':accountId/profiles/:profileId/disconnect')
  @Roles(...ADMIN_ROLES)
  @RequireScope('profiles:write')
  @RequireTenant(
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  )
  @ApiOperation({ summary: 'Disconnect profile' })
  async disconnectProfile(
    @Param('accountId') accountId: string,
    @Param('profileId') profileId: string,
  ) {
    return this.accountsService.disconnectProfile(accountId, profileId);
  }

  // Scanning this QR links a phone to the profile, so a key that may only read profiles must not get it.
  @Get(':accountId/profiles/:profileId/qr')
  @Roles(...ADMIN_ROLES)
  @RequireScope('profiles:write')
  @RequireTenant(
    { from: 'param', key: 'accountId', resource: 'account' },
    { from: 'param', key: 'profileId', resource: 'profile' },
  )
  @ApiOperation({ summary: 'Get QR code for profile' })
  @ApiNotFound('Profile')
  async getQr(
    @Param('accountId') accountId: string,
    @Param('profileId') profileId: string,
  ) {
    return this.accountsService.getQr(accountId, profileId);
  }
}

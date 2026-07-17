// MultiWA Gateway API - Accounts Controller
// apps/api/src/modules/accounts/accounts.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { AccountsService } from './accounts.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateAccountDto, UpdateAccountDto, CreateProfileDto } from './dto';

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
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
  @ApiOperation({ summary: 'Create new account' })
  @ApiValidationError()
  async create(@Body() dto: CreateAccountDto, @Req() req: any) {
    const userId = req.user?.sub || req.user?.id;
    return this.accountsService.create(dto, userId);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'account' })
  @ApiOperation({ summary: 'Update account' })
  @ApiValidationError()
  @ApiNotFound('Account')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'account' })
  @ApiOperation({ summary: 'Delete account' })
  @ApiNotFound('Account')
  async remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }

  // Nested profiles endpoints. Both the account and the profile are tenant-checked
  // so a caller can't pair their own account id with another org's profile id.
  @Get(':accountId/profiles')
  @RequireTenant({ from: 'param', key: 'accountId', resource: 'account' })
  @ApiOperation({ summary: 'Get all profiles for account' })
  @ApiNotFound('Account')
  async getProfiles(@Param('accountId') accountId: string) {
    return this.accountsService.getProfiles(accountId);
  }

  @Post(':accountId/profiles')
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

  @Delete(':accountId/profiles/:profileId')
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

  @Get(':accountId/profiles/:profileId/qr')
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

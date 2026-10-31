// MultiWA Gateway - a profile's call settings
// apps/api/src/modules/calls/profile-calls.controller.ts
//
// Its own route, owner/admin only: the profile update (PUT /profiles/:id) checks no role, and these settings decide
// who can talk to the callers.
import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { UpdateCallSettingsDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiNotFound, ApiValidationError } from '../../common/decorators/api-responses';

@ApiTags('Calls')
@Controller('profiles')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, RolesGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class ProfileCallsController {
  constructor(private readonly calls: CallsService) {}

  @Put(':id/calls-settings')
  @Roles('owner', 'admin')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: "Turn answering this profile's calls in the dashboard on or off" })
  @ApiResponse({ status: 409, description: 'The profile is not ready: `reasons` says why' })
  @ApiNotFound('Profile')
  @ApiValidationError()
  updateCallSettings(@Param('id') id: string, @Body() dto: UpdateCallSettingsDto) {
    return this.calls.updateCallSettings(id, dto);
  }
}

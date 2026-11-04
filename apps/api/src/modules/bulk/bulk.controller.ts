// MultiWA Gateway - Bulk Messaging Controller
// apps/api/src/modules/bulk/bulk.controller.ts

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BulkService } from './bulk.service';
import { SendBulkDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { ADMIN_ROLES } from '../auth/roles';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiRateLimited,
  ApiNotFound,
} from '../../common/decorators/api-responses';

@ApiTags('Bulk Messaging')
@Controller('bulk')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class BulkController {
  constructor(private readonly bulkService: BulkService) {}

  @Post('send')
  @Roles(...ADMIN_ROLES)
  // A bulk send is a broadcast.
  @RequireScope('broadcast:write')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'Send bulk messages with variable substitution',
    description: 'Sends messages to multiple recipients with support for template variables like {name}, {company}. Returns a batch ID for tracking.'
  })
  @ApiValidationError()
  @ApiRateLimited()
  async sendBulk(@Body() dto: SendBulkDto) {
    return this.bulkService.sendBulk(dto);
  }

  @Get('batches')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List all batches for a profile' })
  @ApiQuery({ name: 'profileId', required: true })
  async listBatches(@Query('profileId') profileId: string) {
    return this.bulkService.listBatches(profileId);
  }

  @Get('batch/:batchId')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get batch status with detailed results' })
  @ApiParam({ name: 'batchId', description: 'Batch ID returned from send-bulk' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiNotFound('Batch')
  async getBatchStatus(
    @Param('batchId') batchId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.bulkService.getBatchStatus(batchId, profileId);
  }

  @Post('batch/:batchId/cancel')
  @Roles(...ADMIN_ROLES)
  @RequireScope('broadcast:write')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Cancel a batch in progress' })
  @ApiParam({ name: 'batchId', description: 'Batch ID to cancel' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiNotFound('Batch')
  async cancelBatch(
    @Param('batchId') batchId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.bulkService.cancelBatch(batchId, profileId);
  }
}

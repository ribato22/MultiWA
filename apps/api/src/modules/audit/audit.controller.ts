// MultiWA Gateway - Audit Controller
// apps/api/src/modules/audit/audit.controller.ts

import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors } from '../../common/decorators/api-responses';

// Audit logs are scoped to the caller's organization, always derived from the
// token — never a client-supplied organizationId — so one tenant cannot read
// another tenant's audit trail.
@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Query audit logs for the caller organization' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action prefix (e.g., "auth", "profile")' })
  @ApiQuery({ name: 'resourceType', required: false })
  @ApiQuery({ name: 'resourceId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async query(
    @Request() req: any,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.service.query({
      organizationId: req.user.organizationId,
      userId,
      action,
      resourceType,
      resourceId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit,
      offset,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get audit summary statistics for the caller organization' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Last N days (default: 30)' })
  async getSummary(
    @Request() req: any,
    @Query('days') days?: number,
  ) {
    return this.service.getSummary(req.user.organizationId, days);
  }

  @Get('actions')
  @ApiOperation({ summary: 'List available audit actions' })
  getActions() {
    return Object.entries(require('./audit.service').AuditAction).map(([key, value]) => ({
      key,
      action: value,
      category: (value as string).split('.')[0],
    }));
  }
}

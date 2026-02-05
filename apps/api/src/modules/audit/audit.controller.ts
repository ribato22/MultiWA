// MultiWA Gateway - Audit Controller
// apps/api/src/modules/audit/audit.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Query audit logs' })
  @ApiQuery({ name: 'organizationId', required: true })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action prefix (e.g., "auth", "profile")' })
  @ApiQuery({ name: 'resourceType', required: false })
  @ApiQuery({ name: 'resourceId', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async query(
    @Query('organizationId') organizationId: string,
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
      organizationId,
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
  @ApiOperation({ summary: 'Get audit summary statistics' })
  @ApiQuery({ name: 'organizationId', required: true })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Last N days (default: 30)' })
  async getSummary(
    @Query('organizationId') organizationId: string,
    @Query('days') days?: number,
  ) {
    return this.service.getSummary(organizationId, days);
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

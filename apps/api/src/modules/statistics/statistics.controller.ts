// MultiWA Gateway - Statistics Controller
// apps/api/src/modules/statistics/statistics.controller.ts

import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';

@ApiTags('Statistics')
@Controller('statistics')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
export class StatisticsController {
  constructor(private readonly service: StatisticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get organization dashboard overview' })
  async getDashboard(@Request() req: any) {
    // Always scope to the caller's own organization — never trust a client-supplied id.
    return this.service.getDashboard(req.user.organizationId);
  }

  @Get('messages')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get message statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getMessageStats(
    @Query('profileId') profileId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const range = {
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate) : new Date(),
    };
    return this.service.getMessageStats(profileId, range);
  }

  @Get('messages/trend')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get message trend over time' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'granularity', required: false, enum: ['hour', 'day', 'week'] })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getMessageTrend(
    @Query('profileId') profileId: string,
    @Query('granularity') granularity?: 'hour' | 'day' | 'week',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const range = {
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate) : new Date(),
    };
    return this.service.getMessageTrend(profileId, range, granularity || 'day');
  }

  @Get('contacts')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get contact statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getContactStats(@Query('profileId') profileId: string) {
    return this.service.getContactStats(profileId);
  }

  @Get('broadcasts')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get broadcast statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getBroadcastStats(@Query('profileId') profileId: string) {
    return this.service.getBroadcastStats(profileId);
  }

  @Get('automations')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get automation statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getAutomationStats(@Query('profileId') profileId: string) {
    return this.service.getAutomationStats(profileId);
  }

  @Get('response-time')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Get response time analytics' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getResponseTimeStats(
    @Query('profileId') profileId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const range = {
      startDate: startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endDate: endDate ? new Date(endDate) : new Date(),
    };
    return this.service.getResponseTimeStats(profileId, range);
  }
}

// MultiWA Gateway - Statistics Controller
// apps/api/src/modules/statistics/statistics.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Statistics')
@Controller('statistics')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
export class StatisticsController {
  constructor(private readonly service: StatisticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get organization dashboard overview' })
  @ApiQuery({ name: 'organizationId', required: true })
  async getDashboard(@Query('organizationId') organizationId: string) {
    return this.service.getDashboard(organizationId);
  }

  @Get('messages')
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
  @ApiOperation({ summary: 'Get contact statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getContactStats(@Query('profileId') profileId: string) {
    return this.service.getContactStats(profileId);
  }

  @Get('broadcasts')
  @ApiOperation({ summary: 'Get broadcast statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getBroadcastStats(@Query('profileId') profileId: string) {
    return this.service.getBroadcastStats(profileId);
  }

  @Get('automations')
  @ApiOperation({ summary: 'Get automation statistics' })
  @ApiQuery({ name: 'profileId', required: true })
  async getAutomationStats(@Query('profileId') profileId: string) {
    return this.service.getAutomationStats(profileId);
  }

  @Get('response-time')
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

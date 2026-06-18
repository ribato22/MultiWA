// MultiWA Gateway - Broadcast Controller
// apps/api/src/modules/broadcast/broadcast.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiRateLimited, ApiNotFound } from '../../common/decorators/api-responses';
import { BroadcastService } from './broadcast.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateBroadcastDto, UpdateBroadcastDto, ScheduleBroadcastDto } from './dto';
import { AuditService, AuditAction } from '../audit/audit.service';

@ApiTags('Broadcast')
@Controller('broadcast')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class BroadcastController {
  constructor(
    private readonly service: BroadcastService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Create a broadcast', description: 'Creates a broadcast in draft state. Sending begins only when the broadcast is scheduled or started.' })
  @ApiValidationError()
  async create(@Body() dto: CreateBroadcastDto, @Req() req: any) {
    const result = await this.service.create(dto);
    this.auditService.log({
      action: AuditAction.BROADCAST_CREATE,
      userId: req.user?.id,
      resourceType: 'broadcast',
      resourceId: result.id,
      metadata: { name: dto.name, profileId: dto.profileId },
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List broadcasts' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed'] })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(profileId, { status });
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Get broadcast by ID with stats' })
  @ApiNotFound('Broadcast')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Update broadcast (draft only)' })
  @ApiValidationError()
  @ApiNotFound('Broadcast')
  async update(@Param('id') id: string, @Body() dto: UpdateBroadcastDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Delete broadcast' })
  @ApiNotFound('Broadcast')
  async delete(@Param('id') id: string, @Req() req: any) {
    const result = await this.service.delete(id);
    this.auditService.log({
      action: AuditAction.BROADCAST_DELETE,
      userId: req.user?.id,
      resourceType: 'broadcast',
      resourceId: id,
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }

  @Post(':id/schedule')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Schedule broadcast', description: 'Queues the broadcast to begin sending at the scheduled time.' })
  @ApiValidationError()
  @ApiNotFound('Broadcast')
  async schedule(@Param('id') id: string, @Body() dto: ScheduleBroadcastDto) {
    return this.service.schedule(id, dto);
  }

  @Post(':id/start')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Start broadcast immediately', description: 'Begins sending the broadcast to all recipients right away. Subject to WhatsApp send-rate limits.' })
  @ApiNotFound('Broadcast')
  @ApiRateLimited()
  async start(@Param('id') id: string, @Req() req: any) {
    const result = await this.service.start(id);
    this.auditService.log({
      action: AuditAction.BROADCAST_START,
      userId: req.user?.id,
      resourceType: 'broadcast',
      resourceId: id,
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }

  @Post(':id/pause')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Pause running broadcast' })
  @ApiNotFound('Broadcast')
  async pause(@Param('id') id: string) {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Resume paused broadcast' })
  @ApiNotFound('Broadcast')
  async resume(@Param('id') id: string) {
    return this.service.resume(id);
  }

  @Post(':id/cancel')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Cancel broadcast' })
  @ApiNotFound('Broadcast')
  async cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id/stats')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Get detailed broadcast statistics' })
  @ApiNotFound('Broadcast')
  async getStats(@Param('id') id: string) {
    return this.service.getStats(id);
  }

  @Get(':id/recipients')
  @RequireTenant({ from: 'param', key: 'id', resource: 'broadcast' })
  @ApiOperation({ summary: 'Get recipient list with status' })
  @ApiNotFound('Broadcast')
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'sent', 'delivered', 'failed'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async getRecipients(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.service.getRecipients(id, { status, limit, offset });
  }
}

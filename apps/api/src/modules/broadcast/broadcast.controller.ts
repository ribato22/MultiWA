// MultiWA Gateway - Broadcast Controller
// apps/api/src/modules/broadcast/broadcast.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateBroadcastDto, UpdateBroadcastDto, ScheduleBroadcastDto } from './dto';
import { AuditService, AuditAction } from '../audit/audit.service';

@ApiTags('Broadcast')
@Controller('broadcast')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class BroadcastController {
  constructor(
    private readonly service: BroadcastService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a broadcast' })
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
  @ApiOperation({ summary: 'Get broadcast by ID with stats' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update broadcast (draft only)' })
  async update(@Param('id') id: string, @Body() dto: UpdateBroadcastDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete broadcast' })
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
  @ApiOperation({ summary: 'Schedule broadcast' })
  async schedule(@Param('id') id: string, @Body() dto: ScheduleBroadcastDto) {
    return this.service.schedule(id, dto);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start broadcast immediately' })
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
  @ApiOperation({ summary: 'Pause running broadcast' })
  async pause(@Param('id') id: string) {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume paused broadcast' })
  async resume(@Param('id') id: string) {
    return this.service.resume(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel broadcast' })
  async cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get detailed broadcast statistics' })
  async getStats(@Param('id') id: string) {
    return this.service.getStats(id);
  }

  @Get(':id/recipients')
  @ApiOperation({ summary: 'Get recipient list with status' })
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

// MultiWA Gateway - Automation Controller
// apps/api/src/modules/automation/automation.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateAutomationDto, UpdateAutomationDto, TestAutomationDto } from './dto';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('Automation')
@Controller('automation')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class AutomationController {
  constructor(private readonly service: AutomationService) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Create automation rule' })
  @ApiValidationError()
  async create(@Body() dto: CreateAutomationDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List automation rules' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'triggerType', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('triggerType') triggerType?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.service.findAll(profileId, { triggerType, isActive });
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Get automation rule by ID' })
  @ApiNotFound('Automation')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Update automation rule' })
  @ApiValidationError()
  @ApiNotFound('Automation')
  async update(@Param('id') id: string, @Body() dto: UpdateAutomationDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Delete automation rule' })
  @ApiNotFound('Automation')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Put(':id/toggle')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Toggle automation on/off' })
  @ApiNotFound('Automation')
  async toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  @Post(':id/test')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Test automation with sample message' })
  @ApiValidationError()
  @ApiNotFound('Automation')
  async test(@Param('id') id: string, @Body() dto: TestAutomationDto) {
    return this.service.testRule(id, dto.message);
  }

  @Get(':id/stats')
  @RequireTenant({ from: 'param', key: 'id', resource: 'automation' })
  @ApiOperation({ summary: 'Get automation statistics' })
  @ApiNotFound('Automation')
  async getStats(@Param('id') id: string) {
    return this.service.getStats(id);
  }

  @Post('reorder')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Reorder automation priorities' })
  @ApiValidationError()
  async reorder(@Body() body: { profileId: string; order: string[] }) {
    return this.service.reorder(body.profileId, body.order);
  }
}

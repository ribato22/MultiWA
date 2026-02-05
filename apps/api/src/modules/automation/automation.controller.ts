// MultiWA Gateway - Automation Controller
// apps/api/src/modules/automation/automation.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { AutomationService } from './automation.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateAutomationDto, UpdateAutomationDto, TestAutomationDto } from './dto';

@ApiTags('Automation')
@Controller('automation')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class AutomationController {
  constructor(private readonly service: AutomationService) {}

  @Post()
  @ApiOperation({ summary: 'Create automation rule' })
  async create(@Body() dto: CreateAutomationDto) {
    return this.service.create(dto);
  }

  @Get()
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
  @ApiOperation({ summary: 'Get automation rule by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update automation rule' })
  async update(@Param('id') id: string, @Body() dto: UpdateAutomationDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete automation rule' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Put(':id/toggle')
  @ApiOperation({ summary: 'Toggle automation on/off' })
  async toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test automation with sample message' })
  async test(@Param('id') id: string, @Body() dto: TestAutomationDto) {
    return this.service.testRule(id, dto.message);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get automation statistics' })
  async getStats(@Param('id') id: string) {
    return this.service.getStats(id);
  }

  @Post('reorder')
  @ApiOperation({ summary: 'Reorder automation priorities' })
  async reorder(@Body() body: { profileId: string; order: string[] }) {
    return this.service.reorder(body.profileId, body.order);
  }
}

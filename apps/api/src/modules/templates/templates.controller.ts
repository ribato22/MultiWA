// MultiWA Gateway - Templates Controller
// apps/api/src/modules/templates/templates.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateTemplateDto, UpdateTemplateDto, PreviewTemplateDto } from './dto';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('Templates')
@Controller('templates')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'Create a message template',
    description: 'Registers a reusable message template under the given profile.',
  })
  @ApiValidationError()
  async create(@Body() dto: CreateTemplateDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'List templates',
    description: 'Lists templates for a profile, optionally filtered by category or search term.',
  })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(profileId, { category, search });
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'template' })
  @ApiOperation({ summary: 'Get template by ID' })
  @ApiNotFound('Template')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'template' })
  @ApiOperation({ summary: 'Update template' })
  @ApiValidationError()
  @ApiNotFound('Template')
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'template' })
  @ApiOperation({ summary: 'Delete template' })
  @ApiNotFound('Template')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/preview')
  @RequireTenant({ from: 'param', key: 'id', resource: 'template' })
  @ApiOperation({
    summary: 'Preview template with variables',
    description: 'Renders the template with the supplied variable values without sending anything.',
  })
  @ApiValidationError()
  @ApiNotFound('Template')
  async preview(@Param('id') id: string, @Body() dto: PreviewTemplateDto) {
    return this.service.preview(id, dto.variables);
  }

  @Post(':id/duplicate')
  @RequireTenant({ from: 'param', key: 'id', resource: 'template' })
  @ApiOperation({
    summary: 'Duplicate a template',
    description: 'Clones an existing template, optionally giving the copy a new name.',
  })
  @ApiValidationError()
  @ApiNotFound('Template')
  async duplicate(@Param('id') id: string, @Body('name') newName: string) {
    return this.service.duplicate(id, newName);
  }
}

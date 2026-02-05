// MultiWA Gateway - Templates Controller
// apps/api/src/modules/templates/templates.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTemplateDto, UpdateTemplateDto, PreviewTemplateDto } from './dto';

@ApiTags('Templates')
@Controller('templates')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a message template' })
  async create(@Body() dto: CreateTemplateDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List templates' })
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
  @ApiOperation({ summary: 'Get template by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update template' })
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete template' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/preview')
  @ApiOperation({ summary: 'Preview template with variables' })
  async preview(@Param('id') id: string, @Body() dto: PreviewTemplateDto) {
    return this.service.preview(id, dto.variables);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a template' })
  async duplicate(@Param('id') id: string, @Body('name') newName: string) {
    return this.service.duplicate(id, newName);
  }
}

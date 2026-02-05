// apps/api/src/modules/workspaces/workspaces.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Workspaces')
@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List workspaces' })
  async findAll(@Request() req: any) {
    return this.service.findAll(req.user.organizationId);
  }

  @Post()
  @ApiOperation({ summary: 'Create workspace' })
  async create(@Request() req: any, @Body() dto: any) {
    return this.service.create(req.user.organizationId, dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

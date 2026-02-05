// MultiWA Gateway - API Keys Controller
// apps/api/src/modules/api-keys/api-keys.controller.ts

import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { AuditService, AuditAction } from '../audit/audit.service';

@ApiTags('API Keys')
@Controller('api-keys')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(
    private readonly service: ApiKeysService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for current user' })
  async findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new API key' })
  async create(
    @Req() req: any,
    @Body() body: { name: string; permissions?: string[] },
  ) {
    const result = await this.service.create(req.user.id, body.name, body.permissions);
    this.auditService.log({
      action: AuditAction.APIKEY_CREATE,
      userId: req.user.id,
      resourceType: 'api_key',
      metadata: { name: body.name },
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an API key' })
  async delete(@Req() req: any, @Param('id') id: string) {
    const result = await this.service.delete(id, req.user.id);
    this.auditService.log({
      action: AuditAction.APIKEY_REVOKE,
      userId: req.user.id,
      resourceType: 'api_key',
      resourceId: id,
      ...AuditService.fromRequest(req),
    }).catch(() => {});
    return result;
  }
}

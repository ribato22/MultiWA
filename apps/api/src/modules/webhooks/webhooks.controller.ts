// MultiWA Gateway - Webhooks Controller
// apps/api/src/modules/webhooks/webhooks.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Create a webhook endpoint' })
  async create(@Body() dto: CreateWebhookDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile', optional: true })
  @ApiOperation({ summary: 'List all webhooks' })
  @ApiQuery({ name: 'profileId', required: false })
  async findAll(@Query('profileId') profileId?: string) {
    return this.service.findAll(profileId);
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Get webhook by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Update webhook' })
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Delete webhook' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/test')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Test webhook delivery' })
  async test(@Param('id') id: string) {
    return this.service.testDelivery(id);
  }
}

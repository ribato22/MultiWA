// MultiWA Gateway - Webhooks Controller
// apps/api/src/modules/webhooks/webhooks.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('Webhooks')
@Controller('webhooks')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'Create a webhook endpoint',
    description:
      'Registers a webhook subscription for the given profile so that selected events are delivered to the target URL.',
  })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async create(@Body() dto: CreateWebhookDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List webhooks for a profile' })
  @ApiQuery({ name: 'profileId', required: true })
  async findAll(@Query('profileId') profileId: string) {
    return this.service.findAll(profileId);
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Get webhook by ID' })
  @ApiNotFound('Webhook')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Update webhook' })
  @ApiValidationError()
  @ApiNotFound('Webhook')
  async update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({ summary: 'Delete webhook' })
  @ApiNotFound('Webhook')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/test')
  @RequireTenant({ from: 'param', key: 'id', resource: 'webhook' })
  @ApiOperation({
    summary: 'Test webhook delivery',
    description: 'Sends a sample event to the webhook target URL to verify connectivity and signature handling.',
  })
  @ApiNotFound('Webhook')
  async test(@Param('id') id: string) {
    return this.service.testDelivery(id);
  }
}

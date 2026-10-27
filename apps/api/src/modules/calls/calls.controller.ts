// MultiWA Gateway - Calls Controller
// apps/api/src/modules/calls/calls.controller.ts

import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { CallLinkDto, ListCallsQueryDto, ReplyCallDto, UpdateCallDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiNotFound, ApiValidationError } from '../../common/decorators/api-responses';

@ApiTags('Calls')
@Controller('calls')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class CallsController {
  constructor(private readonly service: CallsService) {}

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List calls of a profile, newest first' })
  @ApiValidationError()
  list(@Query() query: ListCallsQueryDto) {
    return this.service.list(query);
  }

  // NOTE: declared BEFORE the ':id' route so the literal path is not captured by it. (Keep the decorator
  // syntax out of comments: scripts/check-api-contract.mjs reads every line, comments included.)
  @Get('open-count')
  @ApiOperation({ summary: 'Open call follow-ups across the organization' })
  openCount(@Request() req: any) {
    return this.service.openCount(req.user.organizationId);
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Get a call' })
  @ApiNotFound('Call')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Update the follow-up status or the assignee' })
  @ApiNotFound('Call')
  @ApiValidationError()
  update(@Param('id') id: string, @Body() dto: UpdateCallDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/reject')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Reject a call that is still ringing' })
  @ApiNotFound('Call')
  reject(@Param('id') id: string) {
    return this.service.reject(id);
  }

  @Post(':id/reply')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Send a text to the caller (send-gated)' })
  @ApiNotFound('Call')
  @ApiValidationError()
  reply(@Param('id') id: string, @Body() dto: ReplyCallDto) {
    return this.service.reply(id, dto.text);
  }

  @Post(':id/call-link')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Create a WhatsApp call link and send it to the caller' })
  @ApiNotFound('Call')
  @ApiValidationError()
  callLink(@Param('id') id: string, @Body() dto: CallLinkDto) {
    return this.service.sendCallLink(id, dto.type, dto.text);
  }
}

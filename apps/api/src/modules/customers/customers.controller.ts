// MultiWA Gateway API - Customers Controller
// apps/api/src/modules/customers/customers.controller.ts
//
// The customer profile: a customer's ID in the organization's own system, linked to WhatsApp numbers, with the team's
// notes and tags, the customer's chats and calls, and a live lookup of the customer's data. The service scopes every
// route to the caller's organization (another organization's customer, link or note answers 404), so no route takes an
// organization or a profile id. An API key with a scope list needs customers:read for the reads, customers:write for
// the rest.

import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { ADMIN_ROLES, AGENT_ROLES } from '../auth/roles';
import { ApiAuthErrors, ApiNotFound, ApiValidationError } from '../../common/decorators/api-responses';
import { CustomersService, type Actor } from './customers.service';
import { CustomerConfigDto, LinkCustomerDto, NoteDto, TestLookupDto, UpdateCustomerDto } from './dto';

/** Who calls: the user, their organization and role, the API key when the request came with one, and from where. */
function actorOf(req: any): Actor {
  return {
    userId: req.user.id,
    organizationId: req.user.organizationId,
    role: req.user.role,
    apiKeyId: req.user.apiKeyId,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'],
  };
}

@ApiTags('Customers')
@Controller('customers')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard)
@RequireScope('customers:write')
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequireScope('customers:read')
  @ApiOperation({ summary: 'Search customers by ID (prefix), linked number or name' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'At most 100; default 25.' })
  list(@Req() req: any, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') size?: string) {
    return this.service.list(req.user.organizationId, { q, page, pageSize: size });
  }

  @Get('config')
  @RequireScope('customers:read')
  @ApiOperation({ summary: 'The lookup settings; the secret is never sent' })
  config(@Req() req: any) {
    return this.service.getConfig(req.user.organizationId);
  }

  @Put('config')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Change the lookup settings' })
  @ApiValidationError()
  setConfig(@Req() req: any, @Body() dto: CustomerConfigDto) {
    return this.service.setConfig(actorOf(req), dto);
  }

  @Post('config/test')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Run one lookup with the saved settings, bypassing the cache' })
  @ApiValidationError()
  testConfig(@Req() req: any, @Body() dto: TestLookupDto) {
    return this.service.testConfig(req.user.organizationId, dto.externalId);
  }

  @Get('lookup')
  @RequireScope('customers:read')
  @ApiOperation({ summary: 'Preview the lookup of an ID that is not linked yet; stores nothing' })
  @ApiQuery({ name: 'externalId', required: true })
  @ApiValidationError()
  preview(@Req() req: any, @Query('externalId') externalId?: string) {
    return this.service.preview(actorOf(req), externalId);
  }

  @Get('by-phone/:phone')
  @RequireScope('customers:read')
  @ApiOperation({ summary: 'The customers linked to a number, its default first' })
  @ApiValidationError()
  byPhone(@Req() req: any, @Param('phone') phone: string) {
    return this.service.byPhone(req.user.organizationId, phone);
  }

  @Post('links')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: 'Link a number to a customer ID: 201 with a new link, 200 with one that existed' })
  @ApiValidationError()
  async link(@Req() req: any, @Body() dto: LinkCustomerDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.service.link(actorOf(req), dto.externalId, dto.phone);
    reply.status(result.created ? 201 : 200);
    return result;
  }

  @Post('links/:linkId/use')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: "Make a link its number's default" })
  @ApiNotFound('Link')
  useLink(@Req() req: any, @Param('linkId') linkId: string) {
    return this.service.useLink(actorOf(req), linkId);
  }

  @Delete('links/:linkId')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: 'Remove a link; the customer, its notes and tags stay' })
  @ApiNotFound('Link')
  unlink(@Req() req: any, @Param('linkId') linkId: string) {
    return this.service.unlink(actorOf(req), linkId);
  }

  @Get(':id')
  @RequireScope('customers:read')
  @ApiOperation({ summary: 'A customer with its links, tags, manual fields and 20 newest notes' })
  @ApiNotFound('Customer')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: "Change a customer's tags; its name and fields only while no lookup is configured" })
  @ApiValidationError()
  @ApiNotFound('Customer')
  @ApiConflictResponse({ description: 'displayName or manualFields sent while a lookup is configured.' })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(actorOf(req), id, dto);
  }

  @Delete(':id')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Delete a customer with its links and notes' })
  @ApiNotFound('Customer')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(actorOf(req), id);
  }

  @Get(':id/lookup')
  @RequireScope('customers:read')
  @ApiOperation({ summary: "The live lookup of the customer's data" })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean, description: '`true` skips the minute\'s cache, 30 times a minute per user.' })
  @ApiNotFound('Customer')
  lookup(@Req() req: any, @Param('id') id: string, @Query('refresh') refresh?: string) {
    return this.service.lookup(actorOf(req), id, refresh === 'true');
  }

  @Get(':id/history')
  @RequireScope('customers:read')
  @ApiOperation({ summary: "The organization's one-to-one chats and calls with the customer's numbers, newest first" })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'At most 50; default 20.' })
  @ApiNotFound('Customer')
  history(@Req() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.history(req.user.organizationId, id, limit);
  }

  @Get(':id/notes')
  @RequireScope('customers:read')
  @ApiOperation({ summary: "The customer's notes, newest first" })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'At most 100; default 20.' })
  @ApiNotFound('Customer')
  notes(@Req() req: any, @Param('id') id: string, @Query('page') page?: string, @Query('pageSize') size?: string) {
    return this.service.notes(req.user.organizationId, id, page, size);
  }

  @Post(':id/notes')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: 'Add a note' })
  @ApiValidationError()
  @ApiNotFound('Customer')
  addNote(@Req() req: any, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.service.addNote(actorOf(req), id, dto.body);
  }

  @Patch(':id/notes/:noteId')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: 'Edit a note: its author, an owner or an admin' })
  @ApiValidationError()
  @ApiNotFound('Note')
  editNote(@Req() req: any, @Param('id') id: string, @Param('noteId') noteId: string, @Body() dto: NoteDto) {
    return this.service.editNote(actorOf(req), id, noteId, dto.body);
  }

  @Delete(':id/notes/:noteId')
  @Roles(...AGENT_ROLES)
  @ApiOperation({ summary: 'Delete a note: its author, an owner or an admin' })
  @ApiNotFound('Note')
  deleteNote(@Req() req: any, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.service.deleteNote(actorOf(req), id, noteId);
  }
}

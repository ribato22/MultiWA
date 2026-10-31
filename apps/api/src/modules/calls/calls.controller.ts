// MultiWA Gateway - Calls Controller
// apps/api/src/modules/calls/calls.controller.ts

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PassThrough } from 'stream';
import { CallsService } from './calls.service';
import { CallRecordingsService, type RecordingReader } from './recordings/call-recordings.service';
import { AuditService } from '../audit/audit.service';
import { CallLinkDto, ListCallsQueryDto, ReplyCallDto, UpdateCallDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiNotFound, ApiValidationError } from '../../common/decorators/api-responses';

// Who reads or deletes a recording, from where: its audit carries the IP and user agent, like every other audit entry.
const readerOf = (req: any): RecordingReader => ({ ...AuditService.fromRequest(req), userId: req.user.id, organizationId: req.user.organizationId });

@ApiTags('Calls')
@Controller('calls')
// Like MessagesController: the scope check sits between authentication and the tenant lookup. The two routes that send
// a message to the caller ask an API key for a scope, and so do the recording's two (a recording is personal data);
// reject and the other reads, like the conversations routes, do not.
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class CallsController {
  constructor(
    private readonly service: CallsService,
    private readonly recordings: CallRecordingsService,
  ) {}

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

  @Get('media/status')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Readiness of answering calls in the dashboard: the media server and every profile of the organization' })
  mediaStatus(@Request() req: any) {
    return this.service.mediaStatus(req.user.organizationId);
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
  @RequireScope('messages:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Send a text to the caller (send-gated)' })
  @ApiNotFound('Call')
  @ApiValidationError()
  reply(@Param('id') id: string, @Body() dto: ReplyCallDto) {
    return this.service.reply(id, dto.text);
  }

  @Post(':id/call-link')
  @RequireScope('messages:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: 'Create a WhatsApp call link and send it to the caller' })
  @ApiNotFound('Call')
  @ApiValidationError()
  callLink(@Param('id') id: string, @Body() dto: CallLinkDto) {
    return this.service.sendCallLink(id, dto.type, dto.text);
  }

  // A recording is personal data: owner and admin only, an API key with a scope list needs recordings:read, and a play
  // or a download is audited before a byte is sent.
  @Get(':id/recording')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  @RequireScope('recordings:read')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: "The call's recording (audio/webm): HTTP Range for seeking, ?download=1 as an attachment; audited" })
  @ApiProduces('audio/webm')
  @ApiResponse({ status: 206, description: 'One byte range of the recording, with Content-Range' })
  @ApiResponse({ status: 416, description: 'The range starts past the end: `Content-Range: bytes */<size>`' })
  @ApiResponse({ status: 503, description: 'The recordings storage is not configured on this server, or the access could not be audited: nothing is sent' })
  @ApiNotFound('Recording')
  async recording(@Param('id') id: string, @Query('download') download: string | undefined, @Request() req: any, @Res() reply: FastifyReply): Promise<void> {
    // Fastify answers a HEAD with this handler. A HEAD asks for the recording too: play() checks, sizes and audits it as
    // a GET, and reads none of it. Handed a stream, Fastify keeps the headers as they are, the GET's Content-Length and
    // Content-Range (an empty body would make it answer Content-Length: 0), and one already destroyed it drops unread.
    const head = req.method === 'HEAD';
    const playback = await this.recordings.play(id, readerOf(req), req.headers?.range, download === '1' || download === 'true', head);
    reply.code(playback.status).headers(playback.headers).send(head ? new PassThrough().destroy() : playback.body ?? '');
  }

  @Delete(':id/recording')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin')
  @RequireScope('recordings:delete')
  @RequireTenant({ from: 'param', key: 'id', resource: 'call' })
  @ApiOperation({ summary: "Delete the call's recording: the file goes, the row stays marked deleted as evidence" })
  @ApiResponse({ status: 409, description: 'The recording is in another storage location than this server uses now: it cannot be deleted from here' })
  @ApiResponse({ status: 503, description: 'The recordings storage is not configured on this server' })
  @ApiNotFound('Recording')
  deleteRecording(@Param('id') id: string, @Request() req: any) {
    return this.recordings.deleteByAdmin(id, readerOf(req));
  }
}

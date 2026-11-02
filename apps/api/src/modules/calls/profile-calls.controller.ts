// MultiWA Gateway - a profile's call settings and its call announcement
// apps/api/src/modules/calls/profile-calls.controller.ts
//
// Their own routes, owner/admin only: the profile update (PUT /profiles/:id) checks no role, and these decide who can
// talk to the callers, whether the calls are recorded, and what the callers hear first. So an API key with a scope
// list needs profiles:write (the admin's "Manage Profiles") for any of them.
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, PayloadTooLargeException, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PassThrough } from 'stream';
import { CallsService } from './calls.service';
import { CallAnnouncementService } from './recordings/call-announcement.service';
import { ANNOUNCEMENT_MAX_BYTES } from './recordings/announcement-audio';
import { UpdateCallSettingsDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard, apiKeyLacksScope } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireScope } from '../auth/decorators/require-scope.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { ApiAuthErrors, ApiNotFound, ApiValidationError } from '../../common/decorators/api-responses';

type MultipartLimits = { fileSize: number; files: number; fieldSize: number };
type MultipartRequest = { file(options: { limits: MultipartLimits }): Promise<{ toBuffer(): Promise<Buffer> } | undefined> };
const codeOf = (e: unknown) => (e as { code?: unknown } | null)?.code;
// The parser's own errors (no boundary, a malformed part, a body cut short) carry no status, and Nest would answer them
// with a 500; the plugin's errors carry theirs, which Nest answers with. On the parser's own, the plugin stopped reading
// the request (unpiped, paused): the rest of a body larger than what the sockets hold would stay on the wire, and the
// next request on the same kept-alive connection would never be answered. So it is read off and dropped.
function malformedUnlessStatus(request: FastifyRequest, e: unknown) {
  if ((e as { statusCode?: unknown } | null)?.statusCode !== undefined) return e;
  request.raw.resume();
  return new BadRequestException('The multipart/form-data body is malformed');
}

/**
 * The one file of a multipart request, at most `maxBytes`: past it 413, the rest of the file read off the wire and
 * dropped, never kept. The rest of the request is read too: a second file is skipped (left unread, it would stall the
 * next request on the same kept-alive connection, an unrelated one behind nginx), and a field is cut at 1 KB (the
 * fields are held in memory, up to the plugin's 1000 parts).
 */
export async function readUpload(request: FastifyRequest, maxBytes: number): Promise<Buffer> {
  let part: { toBuffer(): Promise<Buffer> } | undefined;
  try {
    part = await (request as unknown as MultipartRequest).file({ limits: { fileSize: maxBytes, files: 1, fieldSize: 1024 } });
  } catch (e) {
    if (codeOf(e) === 'FST_INVALID_MULTIPART_CONTENT_TYPE') throw new BadRequestException('Send the file as multipart/form-data');
    throw malformedUnlessStatus(request, e);
  }
  if (!part) throw new BadRequestException('No file uploaded');
  try {
    return await part.toBuffer();
  } catch (e) {
    if (codeOf(e) === 'FST_REQ_FILE_TOO_LARGE') throw new PayloadTooLargeException(`The file must be at most ${maxBytes / (1024 * 1024)} MB`);
    throw malformedUnlessStatus(request, e);
  }
}

@ApiTags('Calls')
@Controller('profiles')
@UseGuards(JwtOrApiKeyGuard, ApiKeyScopeGuard, RolesGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class ProfileCallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly announcements: CallAnnouncementService,
  ) {}

  @Put(':id/calls-settings')
  @Roles('owner', 'admin')
  @RequireScope('profiles:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: "This profile's call settings: answering in the dashboard, recording, the retention period" })
  @ApiResponse({ status: 409, description: 'Not available for this profile now: `reasons` says why' })
  @ApiNotFound('Profile')
  @ApiValidationError()
  updateCallSettings(@Param('id') id: string, @Body() dto: UpdateCallSettingsDto, @Req() req: { user?: { apiKeyScopes?: string[] } }) {
    // Every night the retention deletes the recordings older than it: a key that may not delete one recording
    // (DELETE /calls/:id/recording) must not delete them all by setting one day.
    if (dto.retentionDays !== undefined && apiKeyLacksScope(req.user, 'recordings:delete')) {
      throw new ForbiddenException('API key missing required scope(s): recordings:delete');
    }
    return this.calls.updateCallSettings(id, dto);
  }

  @Post(':id/calls-announcement')
  // No throttle of its own: the global ThrottlerGuard keys on req.ip, which behind a proxy without TRUST_PROXY is the proxy's
  // for every organization. The two-readers limit of announcement-audio.ts bounds the cost.
  @Roles('owner', 'admin')
  @RequireScope('profiles:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: "Upload the announcement callers hear before a recorded call: mp3, wav, ogg, webm or m4a, at most 2 MB and 30 seconds (half a second more is allowed for encoders' padding)" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 400, description: 'No file, not multipart/form-data, or a malformed body' })
  @ApiResponse({ status: 409, description: 'The recordings storage is not configured (`reasons`)' })
  @ApiResponse({ status: 413, description: 'Larger than 2 MB' })
  @ApiResponse({ status: 415, description: 'Not one of the audio formats' })
  @ApiResponse({ status: 422, description: "Longer than 30 seconds (half a second more is allowed for encoders' padding), or its length is unknown" })
  @ApiResponse({ status: 503, description: 'Two other announcements are being read, or the recordings storage did not answer: try again in a moment' })
  @ApiNotFound('Profile')
  async uploadAnnouncement(@Param('id') id: string, @Req() request: FastifyRequest) {
    return this.announcements.upload(id, await readUpload(request, ANNOUNCEMENT_MAX_BYTES));
  }

  @Get(':id/calls-announcement')
  @Roles('owner', 'admin')
  @RequireScope('profiles:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: "The profile's announcement, to listen to" })
  @ApiProduces('audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4')
  @ApiResponse({ status: 503, description: 'The recordings storage did not answer: try again' })
  @ApiNotFound('Announcement')
  async announcement(@Param('id') id: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    // Fastify answers a HEAD with this handler: sized, not read (up to 2 MB read only to be dropped). Handed a stream,
    // Fastify keeps the Content-Length as it is (an empty body would make it 0), and one already destroyed it drops unread.
    const head = request.method === 'HEAD';
    const { mimeType, size, body } = await this.announcements.read(id, head);
    reply
      .headers({ 'Content-Type': mimeType, 'Content-Length': String(size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      .send(body ?? new PassThrough().destroy());
  }

  @Delete(':id/calls-announcement')
  @Roles('owner', 'admin')
  @RequireScope('profiles:write')
  @RequireTenant({ from: 'param', key: 'id', resource: 'profile' })
  @ApiOperation({ summary: 'Remove the announcement (refused while recording is on)' })
  @ApiResponse({ status: 409, description: 'Recording is on (`reasons`: recording_on)' })
  @ApiNotFound('Profile')
  deleteAnnouncement(@Param('id') id: string) {
    return this.announcements.remove(id);
  }
}

// The call settings and the call announcement are owner/admin only, tenant-checked on the profile, and audited.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Readable } from 'stream';
import { lastValueFrom, of } from 'rxjs';

vi.mock('./calls.service', () => ({ CallsService: class {} }));
vi.mock('./recordings/call-announcement.service', () => ({ CallAnnouncementService: class {} }));
vi.mock('./recordings/call-recordings.service', () => ({ CallRecordingsService: class {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { API_KEY_SCOPE } from '../auth/decorators/require-scope.decorator';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TENANT_CHECK } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { ProfileCallsController, readUpload } from './profile-calls.controller';
import { CallsController } from './calls.controller';

describe('call settings and status routes', () => {
  it('PUT /profiles/:id/calls-settings: owner and admin only, on a profile of their organization', async () => {
    const handler = ProfileCallsController.prototype.updateCallSettings;
    // @Roles checks nothing without RolesGuard: it runs after authentication, before the tenant lookup.
    expect(Reflect.getMetadata(GUARDS_METADATA, ProfileCallsController)).toEqual([JwtOrApiKeyGuard, ApiKeyScopeGuard, RolesGuard, TenantGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(TENANT_CHECK, handler)).toEqual([{ from: 'param', key: 'id', resource: 'profile' }]);
    const calls = { updateCallSettings: vi.fn().mockResolvedValue({ profileId: 'p1', answerInDashboard: true }) };
    expect(await new ProfileCallsController(calls as any, {} as any).updateCallSettings('p1', { answerInDashboard: true }, { user: { id: 'u1' } } as any)).toEqual({ profileId: 'p1', answerInDashboard: true });
    expect(calls.updateCallSettings).toHaveBeenCalledWith('p1', { answerInDashboard: true });
  });

  // An integration key with a scope list (only messages:write, say) changes none of what these routes decide: who
  // talks to the callers, whether the calls are recorded, what they hear first. The admin issues "Manage Profiles".
  it.each(['updateCallSettings', 'uploadAnnouncement', 'announcement', 'deleteAnnouncement'])('%s asks an API key with a scope list for profiles:write', (name) => {
    expect(Reflect.getMetadata(API_KEY_SCOPE, (ProfileCallsController.prototype as any)[name])).toEqual(['profiles:write']);
  });

  // Retention deletes the recordings older than it every night: a key that DELETE /calls/:id/recording refuses
  // (recordings:delete) must not delete them all by setting one day.
  describe('changing the retention', () => {
    const run = async (user: unknown, dto: Record<string, unknown> = { retentionDays: 1 }) => {
      const calls = { updateCallSettings: vi.fn().mockResolvedValue('written') };
      const controller = new ProfileCallsController(calls as any, {} as any);
      const result = await (async () => controller.updateCallSettings('p1', dto, { user } as any))().catch((e: unknown) => e);
      return { result, calls };
    };

    it('403 for an API key with a scope list without recordings:delete, and nothing is changed', async () => {
      const { result, calls } = await run({ apiKeyScopes: ['profiles:write', 'messages:write'] });
      expect(result).toBeInstanceOf(ForbiddenException);
      expect((result as Error).message).toBe('API key missing required scope(s): recordings:delete');
      expect(calls.updateCallSettings).not.toHaveBeenCalled();
    });

    it.each([
      ['an API key with recordings:delete', { apiKeyScopes: ['profiles:write', 'recordings:delete'] }],
      ['an API key with *', { apiKeyScopes: ['*'] }],
      ['an unscoped API key (full access)', { apiKeyScopes: [] }],
      ['a login', { id: 'u1', role: 'owner' }],
    ])('%s changes it', async (_who, user) => {
      const { result, calls } = await run(user);
      expect(result).toBe('written');
      expect(calls.updateCallSettings).toHaveBeenCalledWith('p1', { retentionDays: 1 });
    });

    it('the other settings need no recordings:delete', async () => {
      const { result } = await run({ apiKeyScopes: ['profiles:write'] }, { answerInDashboard: true, recording: false });
      expect(result).toBe('written');
    });
  });

  it('PUT /profiles/:id/calls-settings is audited as profile.calls_settings, with the value it set', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const put = (body: unknown) => {
      const req = { method: 'PUT', params: { id: 'p1' }, body, user: { id: 'u1', organizationId: 'o1' }, headers: {} };
      const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getClass: () => ProfileCallsController,
        getHandler: () => ProfileCallsController.prototype.updateCallSettings,
      };
      return lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({ profileId: 'p1' }) }));
    };
    await put({ answerInDashboard: false });
    expect(audit.log).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'profile.calls_settings', userId: 'u1', organizationId: 'o1', resourceId: 'p1',
      metadata: { answerInDashboard: false, targetId: 'p1', status: 'success' },
    }));
    await put({ answerInDashboard: 'yes' }); // not a value it can set (the pipe refuses it)
    expect(audit.log.mock.lastCall![0].metadata).toEqual({ targetId: 'p1', status: 'success' });
    await put({ recording: true, retentionDays: 30 });
    expect(audit.log.mock.lastCall![0].metadata).toEqual({ recording: true, retentionDays: 30, targetId: 'p1', status: 'success' });
    await put({ retentionDays: '30' }); // not a value it can set
    expect(audit.log.mock.lastCall![0].metadata).toEqual({ targetId: 'p1', status: 'success' });
  });

  it('GET /calls/media/status: owner and admin only, scoped by their organization', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CallsController.prototype.mediaStatus)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(GUARDS_METADATA, CallsController.prototype.mediaStatus)).toEqual([RolesGuard]);
  });
});

describe('the call announcement routes', () => {
  it.each([
    ['uploadAnnouncement', RequestMethod.POST],
    ['announcement', RequestMethod.GET],
    ['deleteAnnouncement', RequestMethod.DELETE],
  ] as const)('%s: owner and admin only, on a profile of their organization', (name, method) => {
    const handler = (ProfileCallsController.prototype as any)[name];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/calls-announcement');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['owner', 'admin']);
    expect(Reflect.getMetadata(TENANT_CHECK, handler)).toEqual([{ from: 'param', key: 'id', resource: 'profile' }]);
  });

  // One file of at most 2 MB, and fields of at most 1 KB: whatever else the request holds is read and dropped.
  it('upload: the one file of the request, at most 2 MB, to the service', async () => {
    const announcements = { upload: vi.fn().mockResolvedValue('stored') };
    const file = vi.fn().mockResolvedValue({ toBuffer: async () => Buffer.from('mp3') });
    await expect(new ProfileCallsController({} as any, announcements as any).uploadAnnouncement('p1', { file } as any)).resolves.toBe('stored');
    expect(file).toHaveBeenCalledWith({ limits: { fileSize: 2 * 1024 * 1024, files: 1, fieldSize: 1024 } });
    expect(announcements.upload).toHaveBeenCalledWith('p1', Buffer.from('mp3'));
  });

  it('preview: the audio with its type and size, never cached, never sniffed', async () => {
    const audio = Readable.from(['x']);
    const announcements = { read: vi.fn().mockResolvedValue({ mimeType: 'audio/mpeg', size: 1, body: audio }) };
    const reply: any = {};
    reply.headers = vi.fn(() => reply);
    reply.send = vi.fn(() => reply);
    await new ProfileCallsController({} as any, announcements as any).announcement('p1', reply);
    expect(reply.headers).toHaveBeenCalledWith({ 'Content-Type': 'audio/mpeg', 'Content-Length': '1', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    expect(reply.send).toHaveBeenCalledWith(audio);
  });

  it('remove: to the service', async () => {
    const announcements = { remove: vi.fn().mockResolvedValue({ profileId: 'p1', announcement: null }) };
    await expect(new ProfileCallsController({} as any, announcements as any).deleteAnnouncement('p1')).resolves.toEqual({ profileId: 'p1', announcement: null });
  });

  it('upload and removal are audited under their own names', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const run = (method: string, handler: unknown) => {
      const req = { method, params: { id: 'p1' }, user: { id: 'u1', organizationId: 'o1' }, headers: {} };
      const context = { switchToHttp: () => ({ getRequest: () => req }), getClass: () => ProfileCallsController, getHandler: () => handler };
      return lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({}) }));
    };
    await run('POST', ProfileCallsController.prototype.uploadAnnouncement);
    expect(audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'profile.calls_announcement', resourceId: 'p1' }));
    await run('DELETE', ProfileCallsController.prototype.deleteAnnouncement);
    expect(audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'profile.calls_announcement_delete', resourceId: 'p1' }));
  });
});

describe('readUpload', () => {
  const request = (file: () => Promise<unknown>) => ({ file: vi.fn(file) }) as any;
  const failing = (code: string) => Object.assign(new Error(code), { code });

  it('400 without a file, and for a request that is not multipart', async () => {
    await expect(readUpload(request(async () => undefined), 10)).rejects.toBeInstanceOf(BadRequestException);
    await expect(readUpload(request(async () => { throw failing('FST_INVALID_MULTIPART_CONTENT_TYPE'); }), 10)).rejects.toThrow('multipart/form-data');
  });

  it('413 past the limit', async () => {
    const tooLarge = request(async () => ({ toBuffer: async () => { throw failing('FST_REQ_FILE_TOO_LARGE'); } }));
    await expect(readUpload(tooLarge, 2 * 1024 * 1024)).rejects.toMatchObject({ status: 413, message: 'The file must be at most 2 MB' });
  });

  // The parser's own errors (no boundary, a body cut short) carry no status: as they are, Nest would answer 500.
  it('an error without a status is a malformed body (400), before the file and while it is read', async () => {
    const malformed = { status: 400, message: 'The multipart/form-data body is malformed' };
    await expect(readUpload(request(async () => { throw new Error('Multipart: Boundary not found'); }), 10)).rejects.toMatchObject(malformed);
    await expect(readUpload(request(async () => ({ toBuffer: async () => { throw failing('ERR_STREAM_PREMATURE_CLOSE'); } })), 10)).rejects.toMatchObject(malformed);
  });

  it('an error with a status as it is: Nest answers with its status', async () => {
    const limit = Object.assign(failing('FST_PARTS_LIMIT'), { statusCode: 413 });
    await expect(readUpload(request(async () => { throw limit; }), 10)).rejects.toBe(limit);
    await expect(readUpload(request(async () => ({ toBuffer: async () => { throw limit; } })), 10)).rejects.toBe(limit);
  });
});

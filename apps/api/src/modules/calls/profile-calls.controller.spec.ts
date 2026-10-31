// The call settings and the call announcement are owner/admin only, tenant-checked on the profile, and audited.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Readable } from 'stream';
import { lastValueFrom, of } from 'rxjs';

vi.mock('./calls.service', () => ({ CallsService: class {} }));
vi.mock('./recordings/call-announcement.service', () => ({ CallAnnouncementService: class {} }));
vi.mock('./recordings/call-recordings.service', () => ({ CallRecordingsService: class {} }));

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
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
    expect(await new ProfileCallsController(calls as any, {} as any).updateCallSettings('p1', { answerInDashboard: true })).toEqual({ profileId: 'p1', answerInDashboard: true });
    expect(calls.updateCallSettings).toHaveBeenCalledWith('p1', { answerInDashboard: true });
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

  it('upload: the one file of the request, at most 2 MB, to the service', async () => {
    const announcements = { upload: vi.fn().mockResolvedValue('stored') };
    const file = vi.fn().mockResolvedValue({ toBuffer: async () => Buffer.from('mp3') });
    await expect(new ProfileCallsController({} as any, announcements as any).uploadAnnouncement('p1', { file } as any)).resolves.toBe('stored');
    expect(file).toHaveBeenCalledWith({ limits: { fileSize: 2 * 1024 * 1024 } });
    expect(announcements.upload).toHaveBeenCalledWith('p1', Buffer.from('mp3'));
  });

  // Each upload is read in a worker thread that can take seconds of CPU: a tight limit, under the app-wide one.
  it('upload: at most 5 a minute', () => {
    const handler = ProfileCallsController.prototype.uploadAnnouncement;
    expect([Reflect.getMetadata('THROTTLER:LIMITdefault', handler), Reflect.getMetadata('THROTTLER:TTLdefault', handler)]).toEqual([5, 60_000]);
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

  it('any other error as it is', async () => {
    const boom = new Error('boom');
    await expect(readUpload(request(async () => ({ toBuffer: async () => { throw boom; } })), 10)).rejects.toBe(boom);
  });
});

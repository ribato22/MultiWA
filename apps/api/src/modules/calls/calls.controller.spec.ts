// CallsController is a thin shell over CallsService, so what is pinned here is the contract at the HTTP edge:
// the ten routes with their guards and tenant checks (a wrong resource or key there is a cross-tenant hole),
// the request DTOs as the API-wide ValidationPipe applies them (the options of app.factory.ts), and the
// hand-over to the service. The service itself is pinned by calls.service.spec.ts.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { BadRequestException, RequestMethod, ValidationPipe, type ArgumentMetadata, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Readable } from 'stream';
import { lastValueFrom, of } from 'rxjs';
import Fastify from 'fastify';

vi.mock('@multiwa/database', () => ({ prisma: {} }));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));
vi.mock('./recordings/call-recordings.service', () => ({ CallRecordingsService: class {} }));

import { TENANT_CHECK, type TenantCheck } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { API_KEY_SCOPE } from '../auth/decorators/require-scope.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { CallsController } from './calls.controller';
import { CallLinkDto, ListCallsQueryDto, ReplyCallDto, UpdateCallDto, UpdateCallSettingsDto } from './dto';

const proto: any = CallsController.prototype;
const BY_ID: TenantCheck = { from: 'param', key: 'id', resource: 'call' };

// handler, verb, path, tenant checks (null: scoped by the caller's organization instead, see the meta-test allowlist)
const ROUTES: Array<[string, RequestMethod, string, TenantCheck[] | null]> = [
  ['list', RequestMethod.GET, '/', [{ from: 'query', key: 'profileId', resource: 'profile' }]],
  ['openCount', RequestMethod.GET, 'open-count', null],
  ['mediaStatus', RequestMethod.GET, 'media/status', null],
  ['get', RequestMethod.GET, ':id', [BY_ID]],
  ['update', RequestMethod.PATCH, ':id', [BY_ID]],
  ['reject', RequestMethod.POST, ':id/reject', [BY_ID]],
  ['reply', RequestMethod.POST, ':id/reply', [BY_ID]],
  ['callLink', RequestMethod.POST, ':id/call-link', [BY_ID]],
  ['recording', RequestMethod.GET, ':id/recording', [BY_ID]],
  ['deleteRecording', RequestMethod.DELETE, ':id/recording', [BY_ID]],
];

describe('CallsController routes', () => {
  it('is behind authentication, the API-key scope check and the tenant guard, in that order', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CallsController)).toEqual([JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, CallsController)).toBe('calls');
  });

  // The two routes that send a message to the caller need what every other send route needs (MessagesController:
  // the `messages:write` scope the admin UI issues as "Send Messages"). Reject and the other reads are not sends: like
  // the conversations routes they ask nothing of an API key's scopes. A recording is personal data: its own scopes.
  it('asks an API key for messages:write on the routes that send a message, for recordings:read and recordings:delete on the recording, and for nothing on the others', () => {
    const scopes = Object.fromEntries(ROUTES.map(([name]) => [name, Reflect.getMetadata(API_KEY_SCOPE, proto[name])]));
    expect(scopes).toEqual({
      list: undefined, openCount: undefined, mediaStatus: undefined, get: undefined, update: undefined, reject: undefined,
      reply: ['messages:write'], callLink: ['messages:write'], recording: ['recordings:read'], deleteRecording: ['recordings:delete'],
    });
    expect(Reflect.getMetadata(API_KEY_SCOPE, CallsController)).toBeUndefined();
  });

  it('serves exactly these ten routes', () => {
    const served = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined);
    expect(served.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  // A recording is personal data: owner and admin only (RolesGuard on the two routes, after the class's guards).
  it('the recording routes are for owners and admins only', () => {
    for (const name of ['recording', 'deleteRecording']) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toEqual(['owner', 'admin']);
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[name])).toEqual([RolesGuard]);
    }
  });

  // What a client must handle besides the 200: a range, a range past the end, a storage this server cannot use or a
  // read it cannot audit, a recording stored where this server cannot delete it.
  it('the recording routes document their other answers', () => {
    const documented = (name: string) => Object.keys(Reflect.getMetadata('swagger/apiResponse', proto[name]) ?? {}).sort();
    expect(documented('recording')).toEqual(['206', '404', '416', '503']);
    expect(documented('deleteRecording')).toEqual(['404', '409', '503']);
  });

  // The service audits it (resourceType call, the recording's id), as it audits a play and retention's deletes: the
  // interceptor's entry would be a second one, under resourceType calls and without the recording.
  it("the interceptor writes nothing for an admin's delete of a recording", async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const req = { method: 'DELETE', params: { id: 'c1' }, user: { id: 'u1', organizationId: 'o1' }, headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => req }), getClass: () => CallsController, getHandler: () => proto.deleteRecording };
    await lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({}) }));
    expect(audit.log).not.toHaveBeenCalled();
  });

  // Fastify answers a HEAD with the GET route's handler: a read, which the interceptor never audits. For the recording,
  // the service has audited it as a play, and an interceptor entry would be a second one.
  it('the interceptor writes nothing for a HEAD, as for a GET', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const req = { method: 'HEAD', params: { id: 'c1' }, user: { id: 'u1', organizationId: 'o1' }, headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => req }), getClass: () => CallsController, getHandler: () => proto.recording };
    await lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({}) }));
    expect(audit.log).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('%s: verb, path and tenant check', (name, method, path, checks) => {
    expect(Reflect.getMetadata(METHOD_METADATA, proto[name])).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, proto[name])).toBe(path);
    expect(Reflect.getMetadata(TENANT_CHECK, proto[name])).toEqual(checks ?? undefined);
  });

  // Express would match ':id' first; keep the literal paths ahead of it whatever the router.
  it('declares open-count and media/status before :id', () => {
    const order = Object.getOwnPropertyNames(proto);
    expect(order.indexOf('openCount')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('mediaStatus')).toBeLessThan(order.indexOf('get'));
  });
});

describe('CallsController hands over to the service', () => {
  function make() {
    const service = { list: vi.fn(), openCount: vi.fn(), mediaStatus: vi.fn(), get: vi.fn(), update: vi.fn(), reject: vi.fn(), reply: vi.fn(), sendCallLink: vi.fn() };
    for (const fn of Object.values(service)) fn.mockResolvedValue('result');
    const recordings = { play: vi.fn(), deleteByAdmin: vi.fn().mockResolvedValue('deleted') };
    return { service, recordings, controller: new CallsController(service as any, recordings as any) };
  }

  it('list: the validated query as it is', async () => {
    const { service, controller } = make();
    const query = Object.assign(new ListCallsQueryDto(), { profileId: 'p1', outcome: 'missed', limit: 5 });
    await expect(controller.list(query)).resolves.toBe('result');
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('open-count and media/status: the organization of the caller, nothing from the request', async () => {
    const { service, controller } = make();
    await controller.openCount({ user: { organizationId: 'org1' } });
    expect(service.openCount).toHaveBeenCalledWith('org1');
    await controller.mediaStatus({ user: { organizationId: 'org1' }, query: { organizationId: 'org2' } });
    expect(service.mediaStatus).toHaveBeenCalledWith('org1');
  });

  it('get, update, reject: the call id, and the body of update', async () => {
    const { service, controller } = make();
    await controller.get('c1');
    expect(service.get).toHaveBeenCalledWith('c1');
    const dto = Object.assign(new UpdateCallDto(), { followUp: 'done', assignedUserId: null });
    await controller.update('c1', dto);
    expect(service.update).toHaveBeenCalledWith('c1', dto);
    await controller.reject('c1');
    expect(service.reject).toHaveBeenCalledWith('c1');
  });

  it('reply: the text alone, and no text when the body has none', async () => {
    const { service, controller } = make();
    await controller.reply('c1', Object.assign(new ReplyCallDto(), { text: 'Maaf, kami hubungi kembali' }));
    expect(service.reply).toHaveBeenLastCalledWith('c1', 'Maaf, kami hubungi kembali');
    await controller.reply('c1', new ReplyCallDto());
    expect(service.reply).toHaveBeenLastCalledWith('c1', undefined);
  });

  it('call-link: the type, then the intro text', async () => {
    const { service, controller } = make();
    await controller.callLink('c1', Object.assign(new CallLinkDto(), { type: 'video', text: 'Join here' }));
    expect(service.sendCallLink).toHaveBeenCalledWith('c1', 'video', 'Join here');
  });

  const fakeReply = () => {
    const reply: any = {};
    reply.code = vi.fn(() => reply);
    reply.headers = vi.fn(() => reply);
    reply.send = vi.fn(() => reply);
    return reply;
  };

  it('recording: the caller as the actor, the Range header, the download flag; the reply gets the status, headers and body', async () => {
    const { recordings, controller } = make();
    const audio = Readable.from(['x']);
    recordings.play.mockResolvedValue({ status: 206, headers: { 'Content-Range': 'bytes 0-0/1' }, body: audio });
    const reply = fakeReply();
    await controller.recording('c1', '1', { user: { id: 'u1', organizationId: 'o1' }, ip: '203.0.113.7', headers: { range: 'bytes=0-0', 'user-agent': 'test-agent' } }, reply);
    expect(recordings.play).toHaveBeenCalledWith('c1', { userId: 'u1', organizationId: 'o1', ip: '203.0.113.7', userAgent: 'test-agent' }, 'bytes=0-0', true);
    expect(reply.code).toHaveBeenCalledWith(206);
    expect(reply.headers).toHaveBeenCalledWith({ 'Content-Range': 'bytes 0-0/1' });
    expect(reply.send).toHaveBeenCalledWith(audio);
  });

  it.each([[undefined, false], ['0', false], ['true', true]])('recording: ?download=%s is a download: %s; no body is an empty one', async (download, expected) => {
    const { recordings, controller } = make();
    recordings.play.mockResolvedValue({ status: 416, headers: {}, body: null });
    const reply = fakeReply();
    await controller.recording('c1', download, { user: { id: 'u1', organizationId: 'o1' }, headers: {} }, reply);
    expect(recordings.play.mock.calls[0][3]).toBe(expected);
    expect(reply.send).toHaveBeenCalledWith('');
  });

  // Fastify answers a HEAD with the GET handler, and reads a body it is handed to the end only to drop it (on S3, the
  // whole download). The read is still audited: a HEAD asks for the recording all the same.
  it('recording: a HEAD reads none of it, answers with the headers of the GET, Content-Length too, and is audited like it', async () => {
    const { recordings, controller } = make();
    let reads = 0;
    recordings.play.mockImplementation(async () => ({
      status: 200,
      headers: { 'Content-Type': 'audio/webm', 'Content-Length': String(64 * 1024) },
      body: new Readable({ read() { reads++; this.push(reads > 64 ? null : Buffer.alloc(1024)); } }),
    }));
    const app = Fastify();
    app.addHook('onRequest', async (req) => { (req as any).user = { id: 'u1', organizationId: 'o1' }; });
    // Waiting for the reply, as Nest's route handler does: resolved before a streamed body is under way, Fastify would
    // send the reply again, empty.
    app.get('/calls/:id/recording', async (req, reply) => {
      await controller.recording('c1', undefined, req, reply);
      return reply;
    });
    try {
      const head = await app.inject({ method: 'HEAD', url: '/calls/c1/recording' });
      expect([head.statusCode, head.headers['content-length'], head.rawPayload.length, reads]).toEqual([200, String(64 * 1024), 0, 0]);
      expect(recordings.play).toHaveBeenCalledTimes(1);
      reads = 0;
      const get = await app.inject({ method: 'GET', url: '/calls/c1/recording' });
      expect([get.statusCode, get.rawPayload.length]).toEqual([200, 64 * 1024]);
    } finally {
      await app.close();
    }
  });

  it('deleteRecording: the call, and the admin who deletes it, from where, as for a play', async () => {
    const { recordings, controller } = make();
    const req = { user: { id: 'u1', organizationId: 'o1' }, ip: '203.0.113.7', headers: { 'user-agent': 'test-agent' } };
    await expect(controller.deleteRecording('c1', req)).resolves.toBe('deleted');
    expect(recordings.deleteByAdmin).toHaveBeenCalledWith('c1', { userId: 'u1', organizationId: 'o1', ip: '203.0.113.7', userAgent: 'test-agent' });
  });
});

// The API-wide pipe, with the options of app.factory.ts.
const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const through = (type: 'query' | 'body', metatype: Type<unknown>, value: unknown) => pipe.transform(value, { type, metatype, data: '' } as ArgumentMetadata);
const query = (value: Record<string, unknown>) => through('query', ListCallsQueryDto, value) as Promise<Record<string, unknown>>;
const body = (metatype: Type<unknown>, value: unknown) => through('body', metatype, value) as Promise<Record<string, unknown>>;
const refused = async (work: Promise<unknown>, field: string) => {
  const err = await work.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  expect(JSON.stringify(err.getResponse())).toContain(field);
};

describe('GET /calls query', () => {
  it('takes the profile alone', async () => {
    const out = await query({ profileId: 'p1' });
    expect(out).toBeInstanceOf(ListCallsQueryDto);
    expect(out).toEqual({ profileId: 'p1' });
  });

  it('keeps every filter and turns the page size into a number (a query string only carries text)', async () => {
    const since = '2026-10-26T00:00:00.000Z';
    const out = await query({ profileId: 'p1', outcome: 'missed', followUp: 'open', from: '628111000111@s.whatsapp.net', since, limit: '25', cursor: 'c9' });
    expect(out).toEqual({ profileId: 'p1', outcome: 'missed', followUp: 'open', from: '628111000111@s.whatsapp.net', since, limit: 25, cursor: 'c9' });
  });

  it('strips what it does not know, like every other route of the API', async () => {
    expect(await query({ profileId: 'p1', status: 'missed', organizationId: 'org2' })).toEqual({ profileId: 'p1' });
  });

  it('needs a profile', async () => {
    await refused(query({}), 'profileId');
    await refused(query({ profileId: '' }), 'profileId');
  });

  it.each(['ringing', 'missed', 'rejected', 'answered_elsewhere', 'unknown'])('accepts the outcome %s', async (outcome) => {
    expect(await query({ profileId: 'p1', outcome })).toMatchObject({ outcome });
  });

  it.each(['open', 'in_progress', 'done'])('accepts the follow-up %s', async (followUp) => {
    expect(await query({ profileId: 'p1', followUp })).toMatchObject({ followUp });
  });

  it('400 for an outcome or a follow-up it does not know, an unreadable date, or two values for one filter', async () => {
    await refused(query({ profileId: 'p1', outcome: 'bogus' }), 'outcome');
    await refused(query({ profileId: 'p1', followUp: 'later' }), 'followUp');
    await refused(query({ profileId: 'p1', since: 'yesterday' }), 'since');
    await refused(query({ profileId: 'p1', outcome: ['missed', 'rejected'] }), 'outcome');
  });

  it.each([['1', 1], ['100', 100]])('accepts the page size %s', async (limit, expected) => {
    expect(await query({ profileId: 'p1', limit })).toMatchObject({ limit: expected });
  });

  it.each(['0', '-3', '101', '5.5', 'many', ''])('400 for the page size "%s"', async (limit) => {
    await refused(query({ profileId: 'p1', limit }), 'limit');
  });

  describe('from', () => {
    it.each([
      ['an exact JID', '628111000111@s.whatsapp.net', '628111000111@s.whatsapp.net'],
      ['an @lid JID', '1234567@lid', '1234567@lid'],
      ['a group JID', '1203630000@g.us', '1203630000@g.us'],
      ['a whatsapp-web.js JID (stored as @s.whatsapp.net)', '628111000111@c.us', '628111000111@s.whatsapp.net'],
      ['a plain phone number', '628111000111', '628111000111@s.whatsapp.net'],
      ['a number with a plus and separators', '+62 811-1000-111', '628111000111@s.whatsapp.net'],
      ['a local number with the 0 prefix (as for a send)', '0811-1000-111', '628111000111@s.whatsapp.net'],
    ])('%s', async (_what, from, expected) => {
      expect(await query({ profileId: 'p1', from })).toMatchObject({ from: expected });
    });

    it.each(['Budi', '12345', 'someone@example.com'])('400 for %j (not a WhatsApp number or JID)', async (from) => {
      await refused(query({ profileId: 'p1', from }), 'from');
    });

    it('400 for two values (?from=a&from=b)', async () => {
      await refused(query({ profileId: 'p1', from: ['628111000111', '628111000222'] }), 'from');
    });
  });
});

describe('PATCH /calls/:id body', () => {
  it('takes a follow-up, an assignee, or null to unassign', async () => {
    expect(await body(UpdateCallDto, { followUp: 'done' })).toEqual({ followUp: 'done' });
    expect(await body(UpdateCallDto, { assignedUserId: 'u1' })).toEqual({ assignedUserId: 'u1' });
    expect(await body(UpdateCallDto, { assignedUserId: null })).toEqual({ assignedUserId: null });
  });

  it('400 for a follow-up it does not know, and strips the rest', async () => {
    await refused(body(UpdateCallDto, { followUp: 'later' }), 'followUp');
    expect(await body(UpdateCallDto, { followUp: 'open', outcome: 'rejected', profileId: 'p2' })).toEqual({ followUp: 'open' });
  });
});

describe('POST /calls/:id/reply body', () => {
  it('takes a text, or none (the profile default)', async () => {
    expect(await body(ReplyCallDto, { text: 'hi' })).toEqual({ text: 'hi' });
    expect(await body(ReplyCallDto, {})).toEqual({});
  });

  it('400 beyond 4096 characters or for a text that is not text', async () => {
    expect(await body(ReplyCallDto, { text: 'x'.repeat(4096) })).toMatchObject({ text: 'x'.repeat(4096) });
    await refused(body(ReplyCallDto, { text: 'x'.repeat(4097) }), 'text');
    await refused(body(ReplyCallDto, { text: 42 }), 'text');
  });
});

describe('POST /calls/:id/call-link body', () => {
  it.each(['voice', 'video'])('takes the type %s with an optional intro', async (type) => {
    expect(await body(CallLinkDto, { type })).toEqual({ type });
    expect(await body(CallLinkDto, { type, text: 'Join here' })).toEqual({ type, text: 'Join here' });
  });

  it('400 without a type, for another type, or for an over-long intro', async () => {
    await refused(body(CallLinkDto, {}), 'type');
    await refused(body(CallLinkDto, { type: 'audio' }), 'type');
    await refused(body(CallLinkDto, { type: 'voice', text: 'x'.repeat(4097) }), 'text');
  });
});

// Turning answering or recording on changes who hears the callers: only a real boolean may do it (the API-wide pipe
// converts implicitly, and Boolean('false') is true). The retention is a whole number of days.
describe('PUT /profiles/:id/calls-settings body', () => {
  // The properties' types, as tsc emits them in the app (emitDecoratorMetadata). The specs' transform emits none, and
  // without them the pipe would convert nothing here.
  beforeAll(() => {
    for (const [key, type] of [['answerInDashboard', Boolean], ['recording', Boolean], ['retentionDays', Number]] as const) {
      Reflect.defineMetadata('design:type', type, UpdateCallSettingsDto.prototype, key);
    }
  });

  it('takes any of its fields, alone or together', async () => {
    expect(await body(UpdateCallSettingsDto, { answerInDashboard: true })).toEqual({ answerInDashboard: true });
    expect(await body(UpdateCallSettingsDto, { recording: false })).toEqual({ recording: false });
    expect(await body(UpdateCallSettingsDto, { retentionDays: 3650 })).toEqual({ retentionDays: 3650 });
    expect(await body(UpdateCallSettingsDto, { answerInDashboard: false, recording: true, retentionDays: 1 })).toEqual({ answerInDashboard: false, recording: true, retentionDays: 1 });
  });

  it.each(['false', 'true', 0, 1, null])('400 for %j, never read as a boolean', async (value) => {
    await refused(body(UpdateCallSettingsDto, { answerInDashboard: value }), 'answerInDashboard');
    await refused(body(UpdateCallSettingsDto, { recording: value }), 'recording');
  });

  it.each([0, 3651, 7.5, '30', null])('400 for a retention of %j days', async (retentionDays) => {
    await refused(body(UpdateCallSettingsDto, { retentionDays }), 'retentionDays');
  });

  it('an empty body passes the pipe: the service refuses it (400, nothing to change)', async () => {
    expect(await body(UpdateCallSettingsDto, {})).toEqual({});
  });
});

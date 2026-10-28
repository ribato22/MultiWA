// CallsController is a thin shell over CallsService, so what is pinned here is the contract at the HTTP edge:
// the seven routes with their guards and tenant checks (a wrong resource or key there is a cross-tenant hole),
// the request DTOs as the API-wide ValidationPipe applies them (the options of app.factory.ts), and the
// hand-over to the service. The service itself is pinned by calls.service.spec.ts.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, RequestMethod, ValidationPipe, type ArgumentMetadata, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

vi.mock('@multiwa/database', () => ({ prisma: {} }));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));

import { TENANT_CHECK, type TenantCheck } from '../../common/tenant/require-tenant.decorator';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { ApiKeyScopeGuard } from '../auth/guards/api-key-scope.guard';
import { API_KEY_SCOPE } from '../auth/decorators/require-scope.decorator';
import { CallsController } from './calls.controller';
import { CallLinkDto, ListCallsQueryDto, ReplyCallDto, UpdateCallDto } from './dto';

const proto: any = CallsController.prototype;
const BY_ID: TenantCheck = { from: 'param', key: 'id', resource: 'call' };

// handler, verb, path, tenant checks (null: scoped by the caller's organization instead, see the meta-test allowlist)
const ROUTES: Array<[string, RequestMethod, string, TenantCheck[] | null]> = [
  ['list', RequestMethod.GET, '/', [{ from: 'query', key: 'profileId', resource: 'profile' }]],
  ['openCount', RequestMethod.GET, 'open-count', null],
  ['get', RequestMethod.GET, ':id', [BY_ID]],
  ['update', RequestMethod.PATCH, ':id', [BY_ID]],
  ['reject', RequestMethod.POST, ':id/reject', [BY_ID]],
  ['reply', RequestMethod.POST, ':id/reply', [BY_ID]],
  ['callLink', RequestMethod.POST, ':id/call-link', [BY_ID]],
];

describe('CallsController routes', () => {
  it('is behind authentication, the API-key scope check and the tenant guard, in that order', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CallsController)).toEqual([JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, CallsController)).toBe('calls');
  });

  // The two routes that send a message to the caller need what every other send route needs (MessagesController:
  // the `messages:write` scope the admin UI issues as "Send Messages"). Reject and the reads are not sends: like
  // the conversations routes they ask nothing of an API key's scopes.
  it('asks an API key for messages:write on the routes that send a message, and for nothing on the others', () => {
    const scopes = Object.fromEntries(ROUTES.map(([name]) => [name, Reflect.getMetadata(API_KEY_SCOPE, proto[name])]));
    expect(scopes).toEqual({
      list: undefined, openCount: undefined, get: undefined, update: undefined, reject: undefined,
      reply: ['messages:write'], callLink: ['messages:write'],
    });
    expect(Reflect.getMetadata(API_KEY_SCOPE, CallsController)).toBeUndefined();
  });

  it('serves exactly these seven routes', () => {
    const served = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined);
    expect(served.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  it.each(ROUTES)('%s: verb, path and tenant check', (name, method, path, checks) => {
    expect(Reflect.getMetadata(METHOD_METADATA, proto[name])).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, proto[name])).toBe(path);
    expect(Reflect.getMetadata(TENANT_CHECK, proto[name])).toEqual(checks ?? undefined);
  });

  // Express would match ':id' first; keep the literal path ahead of it whatever the router.
  it('declares open-count before :id', () => {
    const order = Object.getOwnPropertyNames(proto);
    expect(order.indexOf('openCount')).toBeLessThan(order.indexOf('get'));
  });
});

describe('CallsController hands over to the service', () => {
  function make() {
    const service = { list: vi.fn(), openCount: vi.fn(), get: vi.fn(), update: vi.fn(), reject: vi.fn(), reply: vi.fn(), sendCallLink: vi.fn() };
    for (const fn of Object.values(service)) fn.mockResolvedValue('result');
    return { service, controller: new CallsController(service as any) };
  }

  it('list: the validated query as it is', async () => {
    const { service, controller } = make();
    const query = Object.assign(new ListCallsQueryDto(), { profileId: 'p1', outcome: 'missed', limit: 5 });
    await expect(controller.list(query)).resolves.toBe('result');
    expect(service.list).toHaveBeenCalledWith(query);
  });

  it('open-count: the organization of the caller, nothing from the request', async () => {
    const { service, controller } = make();
    await controller.openCount({ user: { organizationId: 'org1' } });
    expect(service.openCount).toHaveBeenCalledWith('org1');
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

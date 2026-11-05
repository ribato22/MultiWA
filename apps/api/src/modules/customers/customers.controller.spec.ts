// CustomersController is a thin shell over CustomersService. Pinned here: the eighteen routes with their verbs and
// paths, the literal paths ahead of `:id`, the caller handed to the service, a link's 201 or 200, the bodies as the
// API-wide ValidationPipe applies them, and the audit interceptor leaving these routes to the service. Who may call
// each route is pinned by the role snapshot, its API-key scope by api-key-scopes.spec.ts.
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, RequestMethod, ValidationPipe, type ArgumentMetadata, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of } from 'rxjs';

vi.mock('@multiwa/database', () => ({ prisma: {} }));

import { AuditInterceptor } from '../audit/audit.interceptor';
import { CustomersController } from './customers.controller';
import { CustomerConfigDto, LinkCustomerDto, NoteDto, TestLookupDto, UpdateCustomerDto } from './dto';

const proto: any = CustomersController.prototype;
const { GET, POST, PUT, PATCH, DELETE } = RequestMethod;
const ROUTES: Array<[string, RequestMethod, string]> = [
  ['list', GET, '/'],
  ['config', GET, 'config'],
  ['setConfig', PUT, 'config'],
  ['testConfig', POST, 'config/test'],
  ['preview', GET, 'lookup'],
  ['byPhone', GET, 'by-phone/:phone'],
  ['link', POST, 'links'],
  ['useLink', POST, 'links/:linkId/use'],
  ['unlink', DELETE, 'links/:linkId'],
  ['findOne', GET, ':id'],
  ['update', PATCH, ':id'],
  ['remove', DELETE, ':id'],
  ['lookup', GET, ':id/lookup'],
  ['history', GET, ':id/history'],
  ['notes', GET, ':id/notes'],
  ['addNote', POST, ':id/notes'],
  ['editNote', PATCH, ':id/notes/:noteId'],
  ['deleteNote', DELETE, ':id/notes/:noteId'],
];

const req = { user: { id: 'u-member', organizationId: 'org-1', role: 'member', apiKeyId: 'k-1' }, ip: '203.0.113.7', headers: { 'user-agent': 'test-agent' } };
const ACTOR = { userId: 'u-member', organizationId: 'org-1', role: 'member', apiKeyId: 'k-1', ip: '203.0.113.7', userAgent: 'test-agent' };

describe('CustomersController routes', () => {
  it('serves /customers', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CustomersController)).toBe('customers');
  });

  it.each(ROUTES)('%s: verb %s, path %s', (name, method, path) => {
    expect(Reflect.getMetadata(METHOD_METADATA, proto[name])).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, proto[name])).toBe(path);
  });

  it('serves exactly these eighteen routes', () => {
    const served = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined);
    expect(served.sort()).toEqual(ROUTES.map(([name]) => name).sort());
  });

  // Express would match ':id' first; keep the literal paths ahead of it whatever the router.
  it('declares the literal paths before :id', () => {
    const order = Object.getOwnPropertyNames(proto);
    for (const literal of ['config', 'setConfig', 'testConfig', 'preview', 'byPhone', 'link', 'useLink', 'unlink']) {
      expect(order.indexOf(literal)).toBeLessThan(order.indexOf('findOne'));
    }
  });

  it('the audit interceptor writes nothing for them: the service audits them, with the ids', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    for (const [name, method] of ROUTES.filter(([, m]) => m !== GET)) {
      const request = { method: RequestMethod[method], params: { id: 'c-1' }, body: { externalId: '1234567890', phone: '6281100000001' }, user: req.user, headers: {} };
      const context = { switchToHttp: () => ({ getRequest: () => request }), getClass: () => CustomersController, getHandler: () => proto[name] };
      await lastValueFrom(new AuditInterceptor(audit as any).intercept(context as any, { handle: () => of({}) }));
    }
    expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('CustomersController hands over to the service', () => {
  function make() {
    const service: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const fn of ['list', 'getConfig', 'setConfig', 'testConfig', 'preview', 'byPhone', 'link', 'useLink', 'unlink', 'findOne', 'update', 'remove', 'lookup', 'history', 'notes', 'addNote', 'editNote', 'deleteNote']) {
      service[fn] = vi.fn().mockResolvedValue('result');
    }
    return { service, controller: new CustomersController(service as any) };
  }

  it("the reads: the caller's organization, and what the query asks", async () => {
    const { service, controller } = make();
    await controller.list(req, 'budi', '2', '50');
    expect(service.list).toHaveBeenCalledWith('org-1', { q: 'budi', page: '2', pageSize: '50' });
    await controller.config(req);
    expect(service.getConfig).toHaveBeenCalledWith('org-1');
    await controller.byPhone(req, '6281100000001');
    expect(service.byPhone).toHaveBeenCalledWith('org-1', '6281100000001');
    await controller.findOne(req, 'c-1');
    expect(service.findOne).toHaveBeenCalledWith('org-1', 'c-1');
    await controller.history(req, 'c-1', '10');
    expect(service.history).toHaveBeenCalledWith('org-1', 'c-1', '10');
    await controller.notes(req, 'c-1', '2', '20');
    expect(service.notes).toHaveBeenCalledWith('org-1', 'c-1', '2', '20');
  });

  it('a refresh only for ?refresh=true; the lookups and the changes get the caller', async () => {
    const { service, controller } = make();
    await controller.lookup(req, 'c-1', 'true');
    expect(service.lookup).toHaveBeenLastCalledWith(ACTOR, 'c-1', true);
    await controller.lookup(req, 'c-1', '1');
    expect(service.lookup).toHaveBeenLastCalledWith(ACTOR, 'c-1', false);
    await controller.preview(req, '1234567890');
    expect(service.preview).toHaveBeenCalledWith(ACTOR, '1234567890');
    await controller.useLink(req, 'l-1');
    expect(service.useLink).toHaveBeenCalledWith(ACTOR, 'l-1');
    await controller.unlink(req, 'l-1');
    expect(service.unlink).toHaveBeenCalledWith(ACTOR, 'l-1');
    const changes = Object.assign(new UpdateCustomerDto(), { tags: ['vip'] });
    await controller.update(req, 'c-1', changes);
    expect(service.update).toHaveBeenCalledWith(ACTOR, 'c-1', changes);
    await controller.remove(req, 'c-1');
    expect(service.remove).toHaveBeenCalledWith(ACTOR, 'c-1');
    await controller.addNote(req, 'c-1', Object.assign(new NoteDto(), { body: 'hi' }));
    expect(service.addNote).toHaveBeenCalledWith(ACTOR, 'c-1', 'hi');
    await controller.editNote(req, 'c-1', 'n-1', Object.assign(new NoteDto(), { body: 'hello' }));
    expect(service.editNote).toHaveBeenCalledWith(ACTOR, 'c-1', 'n-1', 'hello');
    await controller.deleteNote(req, 'c-1', 'n-1');
    expect(service.deleteNote).toHaveBeenCalledWith(ACTOR, 'c-1', 'n-1');
    const config = Object.assign(new CustomerConfigDto(), { timeoutMs: 3000 });
    await controller.setConfig(req, config);
    expect(service.setConfig).toHaveBeenCalledWith(ACTOR, config);
    await controller.testConfig(req, Object.assign(new TestLookupDto(), { externalId: 'A-1' }));
    expect(service.testConfig).toHaveBeenCalledWith('org-1', 'A-1');
  });

  it('a link answers 201 when it made the link, and 200 when the link existed', async () => {
    const { service, controller } = make();
    const reply = { status: vi.fn() };
    service.link.mockResolvedValueOnce({ created: true }).mockResolvedValueOnce({ created: false });
    const dto = Object.assign(new LinkCustomerDto(), { externalId: '1234567890', phone: '0811-0000-0001' });
    await expect(controller.link(req, dto, reply as any)).resolves.toEqual({ created: true });
    expect(reply.status).toHaveBeenLastCalledWith(201);
    await controller.link(req, dto, reply as any);
    expect(reply.status).toHaveBeenLastCalledWith(200);
    expect(service.link).toHaveBeenCalledWith(ACTOR, '1234567890', '0811-0000-0001');
  });
});

// The API-wide pipe, with the options of app.factory.ts.
const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const body = (metatype: Type<unknown>, value: unknown) => pipe.transform(value, { type: 'body', metatype, data: '' } as ArgumentMetadata);
async function refused(metatype: Type<unknown>, value: unknown, field: string) {
  const err = await body(metatype, value).then(() => null, (e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  expect(JSON.stringify(err.getResponse())).toContain(field);
}
const many = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

describe('the bodies, through the API-wide pipe', () => {
  it('a link needs an ID and a number, and strips the rest', async () => {
    expect(await body(LinkCustomerDto, { externalId: '1234567890', phone: '6281100000001', organizationId: 'org-2' })).toEqual({ externalId: '1234567890', phone: '6281100000001' });
    await refused(LinkCustomerDto, { phone: '6281100000001' }, 'externalId');
    await refused(LinkCustomerDto, { externalId: '1234567890' }, 'phone');
  });

  it('a change takes up to 20 tags of up to 32 characters, a name of up to 200, and up to 20 fields', async () => {
    const most = {
      tags: many(20, (i) => `t${i}`.padEnd(32, 'x')),
      displayName: 'x'.repeat(200),
      manualFields: many(20, () => ({ label: 'x'.repeat(60), value: 'x'.repeat(500) })),
    };
    expect(await body(UpdateCustomerDto, most)).toEqual(most);
    expect(await body(UpdateCustomerDto, { displayName: null })).toEqual({ displayName: null });
    await refused(UpdateCustomerDto, { tags: many(21, (i) => `t${i}`) }, 'tags');
    await refused(UpdateCustomerDto, { tags: ['x'.repeat(33)] }, 'tags');
    await refused(UpdateCustomerDto, { displayName: 'x'.repeat(201) }, 'displayName');
    await refused(UpdateCustomerDto, { manualFields: many(21, () => ({ label: 'a', value: 'b' })) }, 'manualFields');
    await refused(UpdateCustomerDto, { manualFields: [{ label: 'x'.repeat(61), value: 'b' }] }, 'label');
    await refused(UpdateCustomerDto, { manualFields: [{ label: 'a', value: 'x'.repeat(501) }] }, 'value');
  });

  it('a note has at most 2000 characters', async () => {
    expect(await body(NoteDto, { body: 'x'.repeat(2000) })).toEqual({ body: 'x'.repeat(2000) });
    await refused(NoteDto, { body: 'x'.repeat(2001) }, 'body');
    await refused(NoteDto, {}, 'body');
  });

  it('the settings: a label of up to 40 characters, a timeout of 1 to 15 seconds, and a secret fit for a header', async () => {
    const all = { idLabel: 'x'.repeat(40), lookupUrl: 'https://crm.example.com/lookup', secret: 'tok-123', timeoutMs: 15000 };
    expect(await body(CustomerConfigDto, all)).toEqual(all);
    expect(await body(CustomerConfigDto, { lookupUrl: '', secret: '' })).toEqual({ lookupUrl: '', secret: '' });
    await refused(CustomerConfigDto, { idLabel: 'x'.repeat(41) }, 'idLabel');
    for (const timeoutMs of [999, 15001, 2500.5]) await refused(CustomerConfigDto, { timeoutMs }, 'timeoutMs');
    for (const secret of ['two words', 'line\nbreak']) await refused(CustomerConfigDto, { secret }, 'secret');
  });
});

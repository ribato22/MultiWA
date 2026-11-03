// Endpoint contract for the TypeScript SDK: every public method of every
// sub-client, checked against the request it actually puts on the wire.
//
// Each method's requests are asserted in full: HTTP method, origin and full path
// (API base included), query, JSON body keys or multipart fields, and a JSON
// Content-Type only with a JSON body (the API rejects an empty application/json
// body with 400; a multipart body carries its own, which fetch sets). Every
// asserted (method, path) pair must also exist in scripts/api-routes.snapshot.json,
// the route table generated from the API controllers, so a call that drifts from
// the API fails here instead of in a user's app.
//
// The transport is the global fetch, stubbed to echo the request. No network.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MultiWAClient, MultiWAError } from '../src';

const ORIGIN = 'https://gw.example.com';

// Path values; the route check maps these segments back to `:param`.
const ID = 'ID';
const PROFILE = 'PROFILE';
const PHONE = '628123456789';
const PATH_VALUES = new Set([ID, PROFILE, PHONE]);

type Query = Record<string, string | string[]>;
/** A multipart body's fields: a file as "<file name> <type> <bytes>", a text as it is. */
type Form = Record<string, string>;
/** [method, full path, query, JSON body keys, multipart fields]. Neither = no body. */
type Req = [method: string, path: string, query?: Query, bodyKeys?: string[], form?: Form];
type Case = [call: (c: MultiWAClient) => Promise<unknown>, ...requests: Req[]];

const snapshot: { routes: { method: string; path: string }[] } = JSON.parse(
  readFileSync(new URL('../../../scripts/api-routes.snapshot.json', import.meta.url), 'utf8'),
);
const ROUTES = new Set(snapshot.routes.map((r) => `${r.method} ${r.path.replace(/\/:[^/]+/g, '/:param')}`));
const toRoute = (path: string) =>
  path.split('/').map((segment) => (PATH_VALUES.has(segment) ? ':param' : segment)).join('/');

// archive, unarchive and markAsRead read the conversation back after the PUT.
const READ_BACK: Req = ['GET', '/api/v1/conversations/ID', { messageLimit: '1' }];

const CASES: Record<string, Case> = {
  'messages.sendText': [
    (c) => c.messages.sendText({ profileId: PROFILE, to: PHONE, text: 'hi' }),
    ['POST', '/api/v1/messages/text', {}, ['profileId', 'to', 'text']],
  ],
  'messages.sendImage': [
    (c) => c.messages.sendImage({ profileId: PROFILE, to: PHONE, url: 'https://x/i.jpg', caption: 'c' }),
    ['POST', '/api/v1/messages/image', {}, ['profileId', 'to', 'url', 'caption']],
  ],
  'messages.sendVideo': [
    (c) => c.messages.sendVideo({ profileId: PROFILE, to: PHONE, url: 'https://x/v.mp4', caption: 'c' }),
    ['POST', '/api/v1/messages/video', {}, ['profileId', 'to', 'url', 'caption']],
  ],
  'messages.sendAudio': [
    (c) => c.messages.sendAudio({ profileId: PROFILE, to: PHONE, url: 'https://x/a.ogg', ptt: true }),
    ['POST', '/api/v1/messages/audio', {}, ['profileId', 'to', 'url', 'ptt']],
  ],
  'messages.sendDocument': [
    (c) => c.messages.sendDocument({ profileId: PROFILE, to: PHONE, url: 'https://x/d.pdf', filename: 'd.pdf' }),
    ['POST', '/api/v1/messages/document', {}, ['profileId', 'to', 'url', 'filename']],
  ],
  'messages.sendLocation': [
    (c) => c.messages.sendLocation({ profileId: PROFILE, to: PHONE, latitude: 1, longitude: 2, name: 'n' }),
    ['POST', '/api/v1/messages/location', {}, ['profileId', 'to', 'latitude', 'longitude', 'name']],
  ],
  'messages.sendContact': [
    (c) => c.messages.sendContact({ profileId: PROFILE, to: PHONE, contacts: [{ name: 'n', phone: PHONE }] }),
    ['POST', '/api/v1/messages/contact', {}, ['profileId', 'to', 'contacts']],
  ],
  'messages.sendReaction': [
    (c) => c.messages.sendReaction({ profileId: PROFILE, messageId: 'm', emoji: '👍' }),
    ['POST', '/api/v1/messages/reaction', {}, ['profileId', 'messageId', 'emoji']],
  ],
  'messages.sendReply': [
    (c) => c.messages.sendReply({ profileId: PROFILE, to: PHONE, quotedMessageId: 'm', text: 'hi' }),
    ['POST', '/api/v1/messages/reply', {}, ['profileId', 'to', 'quotedMessageId', 'text']],
  ],
  'messages.list': [
    (c) => c.messages.list(ID, { limit: 10, offset: 5 }),
    ['GET', '/api/v1/conversations/ID/messages', { limit: '10', offset: '5' }],
  ],
  'messages.get': [(c) => c.messages.get(ID), ['GET', '/api/v1/messages/ID']],

  'contacts.create': [
    (c) => c.contacts.create({ profileId: PROFILE, phone: PHONE, name: 'n', tags: ['vip'] }),
    ['POST', '/api/v1/contacts', {}, ['profileId', 'phone', 'name', 'tags']],
  ],
  'contacts.list': [
    (c) => c.contacts.list(PROFILE, { search: 's', tags: ['vip', 'new'], limit: 10, offset: 5 }),
    ['GET', '/api/v1/contacts', { profileId: PROFILE, search: 's', tags: ['vip', 'new'], limit: '10', offset: '5' }],
  ],
  'contacts.get': [(c) => c.contacts.get(ID), ['GET', '/api/v1/contacts/ID']],
  'contacts.update': [
    (c) => c.contacts.update(ID, { name: 'n', tags: ['vip'] }),
    ['PUT', '/api/v1/contacts/ID', {}, ['name', 'tags']],
  ],
  'contacts.delete': [(c) => c.contacts.delete(ID), ['DELETE', '/api/v1/contacts/ID']],
  'contacts.import': [
    (c) => c.contacts.import({ profileId: PROFILE, contacts: [{ phone: PHONE }] }),
    ['POST', '/api/v1/contacts/import', {}, ['profileId', 'contacts']],
  ],
  'contacts.importCsv': [
    (c) => c.contacts.importCsv({ profileId: PROFILE, csvData: `phone\n${PHONE}` }),
    ['POST', '/api/v1/contacts/import/csv', {}, ['profileId', 'csvData']],
  ],
  'contacts.exportCsv': [
    (c) => c.contacts.exportCsv(PROFILE, { tags: ['vip', 'new'] }),
    ['GET', '/api/v1/contacts/export/csv', { profileId: PROFILE, tags: ['vip', 'new'] }],
  ],
  'contacts.addTags': [(c) => c.contacts.addTags(ID, ['vip']), ['POST', '/api/v1/contacts/ID/tags', {}, ['tags']]],
  'contacts.removeTags': [
    (c) => c.contacts.removeTags(ID, ['vip']),
    ['DELETE', '/api/v1/contacts/ID/tags', {}, ['tags']],
  ],
  'contacts.validatePhone': [
    (c) => c.contacts.validatePhone(PROFILE, PHONE),
    ['GET', `/api/v1/contacts/profile/PROFILE/validate/${PHONE}`],
  ],
  'contacts.validateBulk': [
    (c) => c.contacts.validateBulk(PROFILE, [PHONE]),
    ['POST', '/api/v1/contacts/profile/PROFILE/validate', {}, ['phones']],
  ],

  'conversations.list': [
    (c) => c.conversations.list(PROFILE, { search: 's', type: 'group', archived: true, limit: 10, offset: 5 }),
    [
      'GET',
      '/api/v1/conversations',
      { profileId: PROFILE, search: 's', type: 'group', archived: 'true', limit: '10', offset: '5' },
    ],
  ],
  'conversations.get': [(c) => c.conversations.get(ID), ['GET', '/api/v1/conversations/ID']],
  'conversations.getMessages': [
    (c) => c.conversations.getMessages(ID, { limit: 10, offset: 5 }),
    ['GET', '/api/v1/conversations/ID/messages', { limit: '10', offset: '5' }],
  ],
  'conversations.archive': [
    (c) => c.conversations.archive(ID),
    ['PUT', '/api/v1/conversations/ID/archive'],
    READ_BACK,
  ],
  'conversations.unarchive': [
    (c) => c.conversations.unarchive(ID),
    ['PUT', '/api/v1/conversations/ID/unarchive'],
    READ_BACK,
  ],
  'conversations.markAsRead': [
    (c) => c.conversations.markAsRead(ID),
    ['PUT', '/api/v1/conversations/ID/read'],
    READ_BACK,
  ],

  'templates.create': [
    (c) => c.templates.create({ profileId: PROFILE, name: 'n', content: { text: 'hi' } }),
    ['POST', '/api/v1/templates', {}, ['profileId', 'name', 'content']],
  ],
  'templates.list': [
    (c) => c.templates.list(PROFILE, { category: 'c', search: 's', limit: 10, offset: 5 }),
    ['GET', '/api/v1/templates', { profileId: PROFILE, category: 'c', search: 's', limit: '10', offset: '5' }],
  ],
  'templates.get': [(c) => c.templates.get(ID), ['GET', '/api/v1/templates/ID']],
  'templates.update': [(c) => c.templates.update(ID, { name: 'n' }), ['PUT', '/api/v1/templates/ID', {}, ['name']]],
  'templates.delete': [(c) => c.templates.delete(ID), ['DELETE', '/api/v1/templates/ID']],
  'templates.preview': [
    (c) => c.templates.preview(ID, { name: 'John' }),
    ['POST', '/api/v1/templates/ID/preview', {}, ['variables']],
  ],
  'templates.duplicate': [
    (c) => c.templates.duplicate(ID, 'Copy'),
    ['POST', '/api/v1/templates/ID/duplicate', {}, ['name']],
  ],

  'broadcasts.create': [
    (c) =>
      c.broadcasts.create({
        profileId: PROFILE,
        name: 'n',
        message: { text: 'hi' },
        recipients: { type: 'all', value: [] },
      }),
    ['POST', '/api/v1/broadcast', {}, ['profileId', 'name', 'message', 'recipients']],
  ],
  'broadcasts.list': [
    (c) => c.broadcasts.list(PROFILE, { status: 'draft', limit: 10, offset: 5 }),
    ['GET', '/api/v1/broadcast', { profileId: PROFILE, status: 'draft', limit: '10', offset: '5' }],
  ],
  'broadcasts.get': [(c) => c.broadcasts.get(ID), ['GET', '/api/v1/broadcast/ID']],
  'broadcasts.update': [(c) => c.broadcasts.update(ID, { name: 'n' }), ['PUT', '/api/v1/broadcast/ID', {}, ['name']]],
  'broadcasts.delete': [(c) => c.broadcasts.delete(ID), ['DELETE', '/api/v1/broadcast/ID']],
  'broadcasts.schedule': [
    (c) => c.broadcasts.schedule(ID, new Date('2026-02-14T09:00:00Z')),
    ['POST', '/api/v1/broadcast/ID/schedule', {}, ['scheduledAt']],
  ],
  'broadcasts.start': [(c) => c.broadcasts.start(ID), ['POST', '/api/v1/broadcast/ID/start']],
  'broadcasts.pause': [(c) => c.broadcasts.pause(ID), ['POST', '/api/v1/broadcast/ID/pause']],
  'broadcasts.resume': [(c) => c.broadcasts.resume(ID), ['POST', '/api/v1/broadcast/ID/resume']],
  'broadcasts.cancel': [(c) => c.broadcasts.cancel(ID), ['POST', '/api/v1/broadcast/ID/cancel']],
  'broadcasts.getStats': [(c) => c.broadcasts.getStats(ID), ['GET', '/api/v1/broadcast/ID/stats']],
  'broadcasts.getRecipients': [
    (c) => c.broadcasts.getRecipients(ID, { status: 'sent', limit: 10, offset: 5 }),
    ['GET', '/api/v1/broadcast/ID/recipients', { status: 'sent', limit: '10', offset: '5' }],
  ],

  'webhooks.create': [
    (c) => c.webhooks.create({ profileId: PROFILE, url: 'https://x/hook', events: ['message.received'] }),
    ['POST', '/api/v1/webhooks', {}, ['profileId', 'url', 'events']],
  ],
  'webhooks.list': [(c) => c.webhooks.list(PROFILE), ['GET', '/api/v1/webhooks', { profileId: PROFILE }]],
  'webhooks.get': [(c) => c.webhooks.get(ID), ['GET', '/api/v1/webhooks/ID']],
  'webhooks.update': [
    (c) => c.webhooks.update(ID, { url: 'https://x/hook' }),
    ['PUT', '/api/v1/webhooks/ID', {}, ['url']],
  ],
  'webhooks.delete': [(c) => c.webhooks.delete(ID), ['DELETE', '/api/v1/webhooks/ID']],
  'webhooks.test': [(c) => c.webhooks.test(ID), ['POST', '/api/v1/webhooks/ID/test']],

  'automations.create': [
    (c) =>
      c.automations.create({ profileId: PROFILE, name: 'n', triggerType: 'keyword', triggerConfig: {}, actions: [] }),
    ['POST', '/api/v1/automation', {}, ['profileId', 'name', 'triggerType', 'triggerConfig', 'actions']],
  ],
  'automations.list': [
    (c) => c.automations.list(PROFILE, { triggerType: 'keyword', isActive: true }),
    ['GET', '/api/v1/automation', { profileId: PROFILE, triggerType: 'keyword', isActive: 'true' }],
  ],
  'automations.get': [(c) => c.automations.get(ID), ['GET', '/api/v1/automation/ID']],
  'automations.update': [
    (c) => c.automations.update(ID, { name: 'n' }),
    ['PUT', '/api/v1/automation/ID', {}, ['name']],
  ],
  'automations.delete': [(c) => c.automations.delete(ID), ['DELETE', '/api/v1/automation/ID']],
  'automations.toggle': [(c) => c.automations.toggle(ID), ['PUT', '/api/v1/automation/ID/toggle']],
  'automations.test': [
    (c) => c.automations.test(ID, 'hi'),
    ['POST', '/api/v1/automation/ID/test', {}, ['message']],
  ],
  'automations.getStats': [(c) => c.automations.getStats(ID), ['GET', '/api/v1/automation/ID/stats']],
  'automations.reorder': [
    (c) => c.automations.reorder(PROFILE, [ID]),
    ['POST', '/api/v1/automation/reorder', {}, ['profileId', 'order']],
  ],

  'calls.list': [
    (c) =>
      c.calls.list(PROFILE, { outcome: 'answered', followUp: 'done', from: PHONE, since: '2026-11-01T00:00:00Z', limit: 20, cursor: 'c-9' }),
    [
      'GET',
      '/api/v1/calls',
      { profileId: PROFILE, outcome: 'answered', followUp: 'done', from: PHONE, since: '2026-11-01T00:00:00Z', limit: '20', cursor: 'c-9' },
    ],
  ],
  'calls.openCount': [(c) => c.calls.openCount(), ['GET', '/api/v1/calls/open-count']],
  'calls.get': [(c) => c.calls.get(ID), ['GET', '/api/v1/calls/ID']],
  'calls.update': [
    (c) => c.calls.update(ID, { followUp: 'in_progress', assignedUserId: 'u-1' }),
    ['PATCH', '/api/v1/calls/ID', {}, ['followUp', 'assignedUserId']],
  ],
  'calls.reject': [(c) => c.calls.reject(ID), ['POST', '/api/v1/calls/ID/reject']],
  'calls.reply': [(c) => c.calls.reply(ID, 'We will call you back'), ['POST', '/api/v1/calls/ID/reply', {}, ['text']]],
  'calls.sendCallLink': [
    (c) => c.calls.sendCallLink(ID, 'voice', 'Tap to call us'),
    ['POST', '/api/v1/calls/ID/call-link', {}, ['type', 'text']],
  ],
  'calls.mediaStatus': [(c) => c.calls.mediaStatus(), ['GET', '/api/v1/calls/media/status']],
  'calls.getRecording': [
    (c) => c.calls.getRecording(ID, { download: true }),
    ['GET', '/api/v1/calls/ID/recording', { download: '1' }],
  ],
  'calls.deleteRecording': [(c) => c.calls.deleteRecording(ID), ['DELETE', '/api/v1/calls/ID/recording']],
  'calls.updateSettings': [
    (c) => c.calls.updateSettings(PROFILE, { answerInDashboard: true, recording: true, retentionDays: 30 }),
    ['PUT', '/api/v1/profiles/PROFILE/calls-settings', {}, ['answerInDashboard', 'recording', 'retentionDays']],
  ],
  'calls.uploadAnnouncement': [
    (c) => c.calls.uploadAnnouncement(PROFILE, new Blob([new Uint8Array(3)], { type: 'audio/mpeg' }), 'notice.mp3'),
    ['POST', '/api/v1/profiles/PROFILE/calls-announcement', {}, undefined, { file: 'notice.mp3 audio/mpeg 3' }],
  ],
  'calls.getAnnouncement': [
    (c) => c.calls.getAnnouncement(PROFILE),
    ['GET', '/api/v1/profiles/PROFILE/calls-announcement'],
  ],
  'calls.deleteAnnouncement': [
    (c) => c.calls.deleteAnnouncement(PROFILE),
    ['DELETE', '/api/v1/profiles/PROFILE/calls-announcement'],
  ],
};

// Methods that must not send a request at all.
const NO_REQUEST = ['webhooks.getLogs'];

type Sent = { method: string; origin: string; path: string; query: Query; bodyKeys?: string[]; contentType?: string; form?: Form };
let sent: Sent[];
/** The response of the next requests; by default each request is echoed as JSON. */
let reply: (() => Response) | undefined;

beforeEach(() => {
  sent = [];
  reply = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(input);
      const query: Query = {};
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key);
        query[key] = values.length > 1 ? values : values[0];
      }
      const form = init.body instanceof FormData ? init.body : undefined;
      sent.push({
        method: String(init.method),
        origin: url.origin,
        path: url.pathname,
        query,
        bodyKeys:
          init.body === undefined ? undefined : form ? [...new Set(form.keys())].sort() : Object.keys(JSON.parse(String(init.body))).sort(),
        contentType: (init.headers as Record<string, string>)['Content-Type'],
        form:
          form &&
          Object.fromEntries(
            [...form].map(([key, value]) => [key, typeof value === 'string' ? value : `${value.name} ${value.type} ${value.size}`]),
          ),
      });
      // Echo the request, so a method's return value shows which response it used.
      return reply?.() ?? new Response(JSON.stringify({ method: init.method, path: url.pathname }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SDK endpoints', () => {
  const client = new MultiWAClient({ apiKey: 'test-key', baseUrl: `${ORIGIN}/api/v1` });

  it.each(Object.entries(CASES))('%s', async (_name, [call, ...expected]) => {
    await call(client);

    expect(sent).toEqual(
      expected.map(([method, path, query = {}, bodyKeys, form]) => ({
        method,
        origin: ORIGIN,
        path,
        query,
        bodyKeys: form ? Object.keys(form).sort() : bodyKeys && [...bodyKeys].sort(),
        contentType: bodyKeys ? 'application/json' : undefined,
        form,
      })),
    );
    for (const [method, path] of expected) {
      const route = `${method} ${toRoute(path)}`;
      expect(ROUTES.has(route), `${route} is not in scripts/api-routes.snapshot.json`).toBe(true);
    }
  });

  it('archive, unarchive and markAsRead resolve to the conversation read back, not the PUT ack', async () => {
    const conversation = { method: 'GET', path: '/api/v1/conversations/ID' };
    await expect(client.conversations.archive(ID)).resolves.toEqual(conversation);
    await expect(client.conversations.unarchive(ID)).resolves.toEqual(conversation);
    await expect(client.conversations.markAsRead(ID)).resolves.toEqual(conversation);
  });

  it('webhooks.getLogs rejects without a request: the API exposes no webhook delivery log', async () => {
    await expect(client.webhooks.getLogs(ID)).rejects.toThrow(/exposes no webhook delivery log/);
    expect(sent).toEqual([]);
  });

  it('calls.update sends a null assignee, which unassigns; calls.reply without a text sends none (the profile default)', async () => {
    await client.calls.update(ID, { assignedUserId: null });
    await client.calls.reply(ID);
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.body)).toEqual(['{"assignedUserId":null}', '{}']);
  });

  it('a recording and an announcement resolve to their bytes and Content-Type', async () => {
    reply = () => new Response(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), { headers: { 'content-type': 'audio/webm' } });
    const recording = await client.calls.getRecording(ID);
    expect(recording.contentType).toBe('audio/webm');
    expect([...recording.data]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(sent[0].query).toEqual({}); // no download: the read is audited as a play
    reply = () => new Response(new Uint8Array([0x49, 0x44, 0x33]), { headers: { 'content-type': 'audio/mpeg' } });
    expect(await client.calls.getAnnouncement(PROFILE)).toEqual({ data: new Uint8Array([0x49, 0x44, 0x33]), contentType: 'audio/mpeg' });
  });

  it('an announcement given as bytes goes as a file', async () => {
    await client.calls.uploadAnnouncement(PROFILE, new Uint8Array([1, 2, 3, 4]));
    expect(sent[0].form).toEqual({ file: 'announcement  4' }); // a file without a type
  });

  it('a refusal rejects with a MultiWAError carrying the reasons', async () => {
    reply = () =>
      new Response(JSON.stringify({ message: 'Recording calls is not available for this profile', reasons: ['no_announcement'] }), {
        status: 409,
      });
    const error = await client.calls.updateSettings(PROFILE, { recording: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MultiWAError);
    expect(error).toMatchObject({
      statusCode: 409,
      message: 'Recording calls is not available for this profile',
      details: { reasons: ['no_announcement'] },
    });
  });

  it('a recording that is not there rejects like any other route', async () => {
    reply = () => new Response(JSON.stringify({ statusCode: 404, message: 'This call has no recording', error: 'Not Found' }), { status: 404 });
    await expect(client.calls.getRecording(ID)).rejects.toMatchObject({ statusCode: 404, message: 'This call has no recording' });
  });

  it('covers every public method of every client', () => {
    const methods = Object.entries(client)
      .filter(([key]) => key !== 'options')
      .flatMap(([name, sub]) =>
        Object.getOwnPropertyNames(Object.getPrototypeOf(sub))
          .filter((m) => m !== 'constructor')
          .map((m) => `${name}.${m}`),
      );
    expect([...Object.keys(CASES), ...NO_REQUEST].sort()).toEqual(methods.sort());
  });
});

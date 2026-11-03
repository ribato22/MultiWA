// The calls routes in the OpenAPI document (/api/docs): each says what it answers. The routes return plain objects,
// which Swagger cannot see by itself, so a client generated from the document would otherwise know no shapes.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

vi.mock('@multiwa/database', () => ({ prisma: {} }));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));
vi.mock('../messages/messages.service', () => ({ MessagesService: class {} }));
vi.mock('./recordings/call-recordings.service', () => ({ CallRecordingsService: class {} }));

import { CallsController } from './calls.controller';
import { ProfileCallsController } from './profile-calls.controller';

let app: NestFastifyApplication;
let doc: OpenAPIObject;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [CallsController, ProfileCallsController] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.init();
  doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
});

afterAll(() => app.close());

const operation = (method: string, path: string) => (doc.paths[`/api/v1${path}`] as Record<string, any>)[method];
const json = (method: string, path: string, status: string) => operation(method, path).responses[status].content['application/json'].schema;
const schema = (name: string) => doc.components!.schemas![name] as { properties: Record<string, any> };
const fields = (name: string) => Object.keys(schema(name).properties).sort();

describe('the calls routes in the OpenAPI document', () => {
  it.each([
    ['get', '/calls', '200', 'CallListDto'],
    ['get', '/calls/open-count', '200', 'CallCountDto'],
    ['get', '/calls/media/status', '200', 'CallsMediaStatusDto'],
    ['get', '/calls/{id}', '200', 'CallDto'],
    ['patch', '/calls/{id}', '200', 'CallDto'],
    ['post', '/calls/{id}/reject', '201', 'CallDto'],
    ['post', '/calls/{id}/reply', '201', 'CallReplyResultDto'],
    ['post', '/calls/{id}/call-link', '201', 'CallLinkResultDto'],
    ['delete', '/calls/{id}/recording', '200', 'DeletedCallRecordingDto'],
    ['put', '/profiles/{id}/calls-settings', '200', 'CallsSettingsDto'],
    ['post', '/profiles/{id}/calls-announcement', '201', 'CallAnnouncementResultDto'],
    ['delete', '/profiles/{id}/calls-announcement', '200', 'CallAnnouncementResultDto'],
  ])('%s %s answers %s with %s', (method, path, status, dto) => {
    expect(json(method, path, status)).toEqual({ $ref: `#/components/schemas/${dto}` });
  });

  it('the recording and the announcement answer their audio; the recording takes ?download', () => {
    const recording = operation('get', '/calls/{id}/recording');
    expect(recording.responses['200'].content['audio/webm'].schema).toEqual({ type: 'string', format: 'binary' });
    expect(recording.parameters).toContainEqual(expect.objectContaining({ name: 'download', in: 'query', required: false }));
    const announcement = operation('get', '/profiles/{id}/calls-announcement').responses['200'].content;
    expect(Object.keys(announcement)).toEqual(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4']);
    for (const type of Object.keys(announcement)) expect(announcement[type].schema).toEqual({ type: 'string', format: 'binary' });
    expect(schema('CallAnnouncementDto').properties.mimeType.enum).toEqual(Object.keys(announcement));
  });

  it('a refusal (409) is { message, reasons }', () => {
    for (const [method, path] of [['put', '/profiles/{id}/calls-settings'], ['post', '/profiles/{id}/calls-announcement'], ['delete', '/profiles/{id}/calls-announcement']]) {
      expect(json(method, path, '409')).toEqual({ $ref: '#/components/schemas/CallsRefusalDto' });
    }
    expect(fields('CallsRefusalDto')).toEqual(['message', 'reasons']);
  });

  it('a call has every field the API answers with; its relations and its recording can be null', () => {
    expect(fields('CallDto')).toEqual([
      'answeredAt', 'answeredBy', 'answeredByUserId', 'assignedUser', 'assignedUserId', 'autoReplySentAt', 'conversation', 'conversationId',
      'createdAt', 'direction', 'endReason', 'endedAt', 'endedBy', 'followUp', 'fromJid', 'id', 'isGroup', 'isVideo', 'metadata', 'outcome',
      'profileId', 'recording', 'rejectedBy', 'startedAt', 'talkSeconds', 'updatedAt', 'waCallId',
    ]);
    const call = schema('CallDto').properties;
    for (const relation of ['assignedUser', 'answeredBy', 'conversation', 'recording']) expect(call[relation].nullable).toBe(true);
    expect(fields('CallRecordingDto')).toEqual(['announcementPlayed', 'bytes', 'createdAt', 'deleteReason', 'deletedAt', 'durationSec', 'id', 'partial']);
    expect(fields('CallListDto')).toEqual(['calls', 'nextCursor']);
  });

  it('the media status has the server, its recordings storage, and each profile with its settings and readiness', () => {
    expect(fields('CallsMediaServerDto')).toEqual(['activeSessions', 'enabled', 'engineHost', 'port', 'recordings', 'worker']);
    expect(fields('CallsRecordingsStorageDto')).toEqual(['configured', 'lastCheck', 'problem', 'storage']);
    expect(fields('CallsProfileStatusDto')).toEqual(['announcement', 'answerInDashboard', 'name', 'profileId', 'ready', 'reasons', 'recording', 'retentionDays']);
    expect(fields('CallLinkResultDto')).toEqual(['call', 'link', 'message']);
  });
});

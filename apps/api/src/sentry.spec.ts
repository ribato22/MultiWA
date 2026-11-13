// What goes to Sentry (@multiwa/engine-runtime's sentry.ts): only with SENTRY_DSN set, and nothing personal.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import * as Sentry from '@sentry/nestjs';
import {
  packageVersion,
  redactText,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  sentryOptions,
} from '@multiwa/engine-runtime';

const apiVersion: string = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

describe('redactText', () => {
  it('replaces chat ids, phone numbers and emails', () => {
    expect(redactText('send to 628123456789@c.us failed')).toBe('send to <chat-id> failed');
    expect(redactText('group 120363012345678901-1234@g.us, 1234567890123@lid and 628123456789:12@s.whatsapp.net')).toBe(
      'group <chat-id>, <chat-id> and <chat-id>',
    );
    expect(redactText('number +62 812-3456-7890 or 628123456789')).toBe('number <number> or <number>');
    expect(redactText('owner someone@example.com')).toBe('owner <email>');
  });

  it('keeps ids, times, versions and ports', () => {
    const kept = 'profile 8bf1a58d-5972-4179-86e7-7b91027f7f3f at 2026-11-13T04:50:24.152Z, multiwa 2.1.0, postgres:5432, 3 attempts';
    expect(redactText(kept)).toBe(kept);
  });
});

describe('scrubSentryEvent', () => {
  const event = () => ({
    message: 'note for 628123456789',
    request: {
      method: 'POST',
      url: 'https://wa.example.com/api/v1/messages/text?token=secret',
      headers: { authorization: 'Bearer abc', 'x-api-key': 'key' },
      cookies: { sid: 'session' },
      data: '{"to":"628123456789","text":"hello"}',
      query_string: 'token=secret',
    },
    user: { id: 'u1', ip_address: '10.1.2.3', email: 'someone@example.com' },
    exception: { values: [{ type: 'Error', value: 'Send to 628123456789@c.us failed' }] },
    breadcrumbs: [
      { category: 'console', message: 'Incoming from 628123456789: hello' },
      { category: 'http', data: { url: 'https://hooks.example.com/in?key=secret', method: 'POST', status_code: 503, 'http.query': 'key=secret' } },
    ],
  });

  it("keeps a request's method and path only, and no user", () => {
    const e = scrubSentryEvent(event())!;
    expect(e.request).toEqual({ method: 'POST', url: 'https://wa.example.com/api/v1/messages/text' });
    expect(e).not.toHaveProperty('user');
  });

  it('replaces numbers in the exception and the message', () => {
    const e = scrubSentryEvent(event())!;
    expect(e.exception.values[0].value).toBe('Send to <chat-id> failed');
    expect(e.message).toBe('note for <number>');
  });

  it("drops console breadcrumbs (log lines) and keeps an http one's path, method and status", () => {
    const e = scrubSentryEvent(event())!;
    expect(e.breadcrumbs).toEqual([{ category: 'http', data: { url: 'https://hooks.example.com/in', method: 'POST', status_code: 503 } }]);
    expect(scrubSentryBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });

  it("keeps a Prisma error's first line and its reason, not the query between them", () => {
    const prisma = [
      '',
      'Invalid `prisma.message.create()` invocation in',
      '/app/apps/api/dist/modules/messages/messages.service.js:120:47',
      '',
      '  117',
      '→ 120 await prisma.message.create({',
      '        data: {',
      '          content: "hello there",',
      '          senderJid: "628123456789@c.us"',
      '        }',
      '      })',
      '',
      'Argument `profileId` is missing.',
    ].join('\n');
    const e = scrubSentryEvent({ exception: { values: [{ value: prisma }] } })!;
    expect(e.exception.values[0].value).toBe('Invalid `prisma.message.create()` invocation: Argument `profileId` is missing.');
  });

  it('drops a browser lifecycle error, which the rejection guard ignores on purpose', () => {
    expect(scrubSentryEvent({ exception: { values: [{ value: 'Protocol error (Runtime.callFunctionOn): Target closed.' }] } })).toBeNull();
  });
});

describe('sentryOptions', () => {
  it('is off without SENTRY_DSN', () => {
    expect(sentryOptions('api', __dirname, {})).toBeUndefined();
    expect(sentryOptions('api', __dirname, { SENTRY_DSN: '  ' })).toBeUndefined();
  });

  it("names the environment, the release (the app's own version) and the service", () => {
    const dsn = 'https://public@sentry.example.com/1';
    expect(sentryOptions('worker', __dirname, { SENTRY_DSN: dsn, NODE_ENV: 'production' })).toMatchObject({
      dsn,
      environment: 'production',
      release: `multiwa@${apiVersion}`,
      sendDefaultPii: false,
      initialScope: { tags: { service: 'worker' } },
    });
    expect(sentryOptions('api', __dirname, { SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'staging', NODE_ENV: 'production' })?.environment).toBe(
      'staging',
    );
    expect(packageVersion(__dirname)).toBe(apiVersion);
    expect(packageVersion(path.parse(__dirname).root)).toBeUndefined();
  });
});

describe('Sentry with these options', () => {
  afterEach(async () => {
    await Sentry.close();
  });

  it('sends the event scrubbed, with its service and release', async () => {
    const sent: unknown[][] = [];
    Sentry.init({
      ...sentryOptions('api', __dirname, { SENTRY_DSN: 'https://public@sentry.example.com/1', NODE_ENV: 'test' })!,
      defaultIntegrations: false,
      skipOpenTelemetrySetup: true,
      transport: () => ({
        send: async (envelope) => {
          sent.push(envelope[1] as unknown[]);
          return {};
        },
        flush: async () => true,
      }),
    });
    Sentry.captureException(new Error('Send to 628123456789@c.us failed'));
    await Sentry.flush(2000);
    const events = sent.flat().filter((item) => (item as [{ type: string }])[0].type === 'event').map((item) => (item as [unknown, any])[1]);
    expect(events).toHaveLength(1);
    expect(events[0].exception.values[0].value).toBe('Send to <chat-id> failed');
    expect(events[0].tags).toMatchObject({ service: 'api' });
    expect(events[0].release).toBe(`multiwa@${apiVersion}`);
  });

  it('main.ts loads it before anything else', () => {
    const imports = readFileSync(path.join(__dirname, 'main.ts'), 'utf8').split('\n').filter((l) => l.startsWith('import '));
    expect(imports[0]).toBe("import './instrument';");
  });
});

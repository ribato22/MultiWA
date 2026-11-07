// Compose passes every call media setting to the api, and only docker-compose.calls-media.yml publishes its media
// port. The api service lists its environment explicitly, so a variable missing here never reaches the container.
// Before this guard, CALLS_MEDIA_ENABLED did not. Media is UDP/TCP straight to the api: it cannot go through the HTTP
// proxy. The port is published only on request: on every install it could clash with a port the host already uses,
// and then the api would not start, even with calls off.
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { composeService, readCompose } from './testing/compose';

/** Every CALLS_MEDIA_* variable the media server reads. */
const SETTINGS = [
  ...new Set([...readFileSync(path.join(__dirname, 'modules/calls/media/media-config.ts'), 'utf8').matchAll(/env\.(CALLS_MEDIA_[A-Z_]+)/g)].map((m) => m[1])),
];

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  it('passes every call media setting to the api (off by default)', () => {
    const api = composeService(file, 'api') ?? '';
    expect(SETTINGS).toEqual(expect.arrayContaining(['CALLS_MEDIA_ENABLED', 'CALLS_MEDIA_LISTEN_IP', 'CALLS_MEDIA_ICE_SERVERS']));
    for (const name of SETTINGS) expect(api, name).toMatch(new RegExp(`^ +${name}: \\$\\{${name}:-`, 'm'));
    expect(api).toMatch(/CALLS_MEDIA_ENABLED: \$\{CALLS_MEDIA_ENABLED:-false\}/);
    expect(api).toMatch(/CALLS_MEDIA_PORT: \$\{CALLS_MEDIA_PORT:-40000\}/);
    expect(api).toMatch(/CALLS_MAX_TALK_MINUTES: \$\{CALLS_MAX_TALK_MINUTES:-120\}/);
  });

  it('does not publish the media port: docker-compose.calls-media.yml does, on request', () => {
    expect(readCompose(file)).not.toMatch(/CALLS_MEDIA_PORT[^\n]*\/(udp|tcp)/);
  });
});

it('docker-compose.calls-media.yml publishes the api media port on the same number, UDP and TCP', () => {
  const api = composeService('docker-compose.calls-media.yml', 'api') ?? '';
  expect(api).toContain('"${CALLS_MEDIA_PORT:-40000}:${CALLS_MEDIA_PORT:-40000}/udp"');
  expect(api).toContain('"${CALLS_MEDIA_PORT:-40000}:${CALLS_MEDIA_PORT:-40000}/tcp"');
});

// Compose passes the call media settings to the api and publishes its media port. The api service lists its
// environment explicitly, so a variable missing here never reaches the container. Before this guard,
// CALLS_MEDIA_ENABLED did not. Media is UDP/TCP straight to the api: it cannot go through the HTTP proxy.
import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** The `api:` service block of a compose file (two-space service indent). */
function apiBlock(file: string): string {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const start = text.search(/^ {2}api:\s*$/m);
  expect(start, `${file} has no api service`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  it('passes the call media settings to the api (off by default)', () => {
    const api = apiBlock(file);
    expect(api).toMatch(/CALLS_MEDIA_ENABLED: \$\{CALLS_MEDIA_ENABLED:-false\}/);
    expect(api).toMatch(/CALLS_MEDIA_PORT: \$\{CALLS_MEDIA_PORT:-40000\}/);
    expect(api).toMatch(/CALLS_MEDIA_ANNOUNCED_ADDRESS: \$\{CALLS_MEDIA_ANNOUNCED_ADDRESS:-\}/);
  });

  it('publishes the media port on the same number, UDP and TCP', () => {
    const api = apiBlock(file);
    expect(api).toContain('"${CALLS_MEDIA_PORT:-40000}:${CALLS_MEDIA_PORT:-40000}/udp"');
    expect(api).toContain('"${CALLS_MEDIA_PORT:-40000}:${CALLS_MEDIA_PORT:-40000}/tcp"');
  });
});

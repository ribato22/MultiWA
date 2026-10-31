// Local call recordings must outlive the container: every compose file with an api gives CALL_RECORDINGS_PATH a named
// volume of its own (never the sessions volume, whose snapshots would carry every recording, nor the media folder,
// which is served without a login), and passes the recordings storage settings: a variable missing from a service never
// reaches its container.
import { describe, it, expect } from 'vitest';
import { composeService, readCompose } from './testing/compose';

const SETTINGS = ['CALL_RECORDINGS_STORAGE', 'CALL_RECORDINGS_BUCKET', 'CALL_RECORDINGS_PREFIX', 'CALL_RECORDINGS_SSE'];

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  const api = composeService(file, 'api');

  it('gives the api a recordings directory on a volume of its own', () => {
    expect(api, `${file} has no api service`).not.toBeNull();
    expect(api).toContain('CALL_RECORDINGS_PATH: ${CALL_RECORDINGS_PATH:-/data/call-recordings}');
    expect(api).toMatch(/^\s+- call_recordings:\/data\/call-recordings$/m);
    expect(readCompose(file)).toMatch(/^volumes:\n(?: {2}\S.*\n)*? {2}call_recordings:\s*$/m);
  });

  it('passes the recordings storage settings', () => {
    for (const name of SETTINGS) expect(api).toContain(`${name}: \${${name}:-}`);
  });
});

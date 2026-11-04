// Compose passes ALLOW_REGISTRATION to the api, closed by default. The api service lists its environment explicitly,
// so a variable missing there never reaches the container, and ALLOW_REGISTRATION=true would do nothing.
import { describe, it, expect } from 'vitest';
import { composeService } from './testing/compose';

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  it('passes ALLOW_REGISTRATION to the api (closed by default)', () => {
    const api = composeService(file, 'api');
    expect(api, `${file} has no api service`).not.toBeNull();
    expect(api).toMatch(/^ +ALLOW_REGISTRATION: \$\{ALLOW_REGISTRATION:-false\}$/m);
  });
});

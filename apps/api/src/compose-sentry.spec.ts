// Sentry's two settings reach the api and the worker in every compose file, empty (off) unless the .env sets them.
import { describe, it, expect } from 'vitest';
import { composeService } from './testing/compose';

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  it('passes SENTRY_DSN and SENTRY_ENVIRONMENT to the api and the worker', () => {
    expect(composeService(file, 'api'), `${file} has no api service`).not.toBeNull();
    for (const name of ['api', 'worker']) {
      const service = composeService(file, name);
      if (!service) continue; // the dev file has no worker
      expect(service, `${file} ${name}`).toContain('SENTRY_DSN: ${SENTRY_DSN:-}');
      expect(service, `${file} ${name}`).toContain('SENTRY_ENVIRONMENT: ${SENTRY_ENVIRONMENT:-}');
    }
  });
});

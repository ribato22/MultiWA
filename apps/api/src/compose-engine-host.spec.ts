// The api and the worker must agree on ENGINE_HOST. With 'worker' the worker hosts the WhatsApp engines and the api
// hands its engine work to it; an api that never saw the setting would also open every session itself, on the shared
// sessions volume, so each profile would run twice. Before this guard only the worker was given it. A compose file
// without a worker must not give it to the api: nothing else could host the engines.
import { describe, it, expect } from 'vitest';
import { composeService } from './testing/compose';

const ENGINE_HOST = 'ENGINE_HOST: ${ENGINE_HOST:-api}';

describe.each(['docker-compose.yml', 'docker-compose.production.yml', 'docker-compose.dev.yml'])('%s', (file) => {
  it('gives the api the ENGINE_HOST it gives the worker (default api), and none without a worker', () => {
    const api = composeService(file, 'api');
    const worker = composeService(file, 'worker');
    expect(api, `${file} has no api service`).not.toBeNull();
    if (worker) {
      expect(worker).toContain(ENGINE_HOST);
      expect(api).toContain(ENGINE_HOST);
    } else {
      expect(api).not.toContain('ENGINE_HOST');
    }
  });
});

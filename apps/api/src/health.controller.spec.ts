// /health is public: it shows whether the call media server is on and its worker is up, and nothing else about it.
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports only whether the call media server is on and up, next to the basics', () => {
    const callMedia = {
      status: () => ({ enabled: true, worker: 'up', port: 40000, activeRooms: 1 }), // for authenticated readers
      publicStatus: () => ({ enabled: true, worker: 'up' }),
    };
    const h = new HealthController(callMedia as any).health();
    expect(h).toMatchObject({ status: 'ok', service: 'multiwa-gateway-api' });
    expect(h.callsMedia).toEqual({ enabled: true, worker: 'up' });
  });
});

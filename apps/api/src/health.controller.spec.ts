// /health shows the call media server's state, without addresses (the endpoint is public).
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports the call media server next to the basics', () => {
    const status = { enabled: true, worker: 'up', port: 40000, announcedAddressSet: true, activeRooms: 1 } as const;
    const h = new HealthController({ status: () => status } as any).health();
    expect(h).toMatchObject({ status: 'ok', service: 'multiwa-gateway-api', callsMedia: status });
  });
});

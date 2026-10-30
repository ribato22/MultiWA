// The call media server's settings, read once at boot. Off unless CALLS_MEDIA_ENABLED=true; on, a missing or bad
// value fails with the variable's name, and never echoes a credential.
import { describe, it, expect } from 'vitest';
import { readCallMediaConfig } from './media-config';

const iface = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: null });
const IFACES: any = { lo: [iface('127.0.0.1', true)], eth0: [iface('172.17.0.4')] };
const on = (more: Record<string, string> = {}) => ({ CALLS_MEDIA_ENABLED: 'true', CALLS_MEDIA_ANNOUNCED_ADDRESS: '192.0.2.10', ...more });

describe('readCallMediaConfig', () => {
  it.each([undefined, 'false', '1', 'TRUE'])('is off unless CALLS_MEDIA_ENABLED is exactly "true" (%s)', (v) => {
    expect(readCallMediaConfig({ CALLS_MEDIA_ENABLED: v }, IFACES)).toBeNull();
  });

  it('defaults: port 40000, listens on the first external IPv4, no ICE servers', () => {
    expect(readCallMediaConfig(on(), IFACES)).toEqual({ port: 40000, announcedAddress: '192.0.2.10', listenIp: '172.17.0.4', iceServers: [] });
  });

  it('takes the port, the listen IP and the ICE servers from the env', () => {
    const c = readCallMediaConfig(on({ CALLS_MEDIA_PORT: '41000', CALLS_MEDIA_LISTEN_IP: '127.0.0.1', CALLS_MEDIA_ICE_SERVERS: '[{"urls":"turn:turn.example.com:3478","username":"u","credential":"s"}]' }), IFACES);
    expect(c).toEqual({ port: 41000, announcedAddress: '192.0.2.10', listenIp: '127.0.0.1', iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 's' }] });
  });

  it('requires the announced address when enabled, naming the variable', () => {
    expect(() => readCallMediaConfig({ CALLS_MEDIA_ENABLED: 'true' }, IFACES)).toThrow(/CALLS_MEDIA_ANNOUNCED_ADDRESS is required/);
    expect(() => readCallMediaConfig(on({ CALLS_MEDIA_ANNOUNCED_ADDRESS: 'bad host' }), IFACES)).toThrow(/CALLS_MEDIA_ANNOUNCED_ADDRESS must be/);
  });

  it.each(['0', '65536', 'abc', '40000.5'])('refuses port %s', (p) => {
    expect(() => readCallMediaConfig(on({ CALLS_MEDIA_PORT: p }), IFACES)).toThrow(/CALLS_MEDIA_PORT must be/);
  });

  it('fails when nothing to listen on is set or found', () => {
    expect(() => readCallMediaConfig(on(), { lo: [iface('127.0.0.1', true)] } as any)).toThrow(/CALLS_MEDIA_LISTEN_IP/);
  });

  it('refuses ICE servers that are not a JSON array of { urls, username?, credential? }, without echoing them', () => {
    const secret = '[{"urls":5,"credential":"hunter2"}]';
    expect(() => readCallMediaConfig(on({ CALLS_MEDIA_ICE_SERVERS: secret }), IFACES)).toThrow(/CALLS_MEDIA_ICE_SERVERS must be/);
    try { readCallMediaConfig(on({ CALLS_MEDIA_ICE_SERVERS: secret }), IFACES); } catch (e) { expect(String(e)).not.toContain('hunter2'); }
    expect(() => readCallMediaConfig(on({ CALLS_MEDIA_ICE_SERVERS: '{not json' }), IFACES)).toThrow(/CALLS_MEDIA_ICE_SERVERS must be JSON/);
  });
});

// The call media server's settings, read once at boot. Off unless CALLS_MEDIA_ENABLED=true; on, a missing or bad
// value (an ICE server URL that is not stun:/stuns:/turn:/turns:, a turn server without credentials) fails with the
// variable's name, and never echoes a value.
import { describe, it, expect } from 'vitest';
import { readCallMediaConfig } from './media-config';

const iface = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '255.0.0.0', mac: '00:00:00:00:00:00', cidr: null });
const IFACES: any = { lo: [iface('127.0.0.1', true)], eth0: [iface('172.17.0.4')] };
const on = (more: Record<string, string> = {}) => ({ CALLS_MEDIA_ENABLED: 'true', CALLS_MEDIA_ANNOUNCED_ADDRESS: '192.0.2.10', ...more });

describe('readCallMediaConfig', () => {
  it.each([undefined, 'false', '1', 'TRUE'])('is off unless CALLS_MEDIA_ENABLED is exactly "true" (%s)', (v) => {
    expect(readCallMediaConfig({ CALLS_MEDIA_ENABLED: v }, IFACES)).toBeNull();
  });

  it('is off with ENGINE_HOST=worker: the WhatsApp Web pages it would serve run in the worker', () => {
    expect(readCallMediaConfig(on({ ENGINE_HOST: 'worker' }), IFACES)).toBeNull();
    expect(readCallMediaConfig(on({ ENGINE_HOST: 'api' }), IFACES)).not.toBeNull();
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

  it.each(['::1', '10.0.0', 'localhost', '127.0.0.1:40000'])('refuses listen IP %s: only an IPv4 address', (ip) => {
    expect(() => readCallMediaConfig(on({ CALLS_MEDIA_LISTEN_IP: ip }), IFACES)).toThrow(/CALLS_MEDIA_LISTEN_IP must be an IPv4 address/);
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

  it('accepts stun servers without credentials, and turn servers with both', () => {
    const servers = [
      { urls: 'stun:stun.example.com:3478' },
      { urls: ['stuns:stun.example.com:5349', 'stun:stun.example.com:3478'] },
      { urls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349'], username: 'u', credential: 's' },
    ];
    expect(readCallMediaConfig(on({ CALLS_MEDIA_ICE_SERVERS: JSON.stringify(servers) }), IFACES)?.iceServers).toEqual(servers);
  });

  it.each([
    ['a URL without a scheme', [{ urls: 'stun.example.com:3478' }]],
    ['an empty URL', [{ urls: '' }]],
    ['an empty URL among others', [{ urls: ['stun:stun.example.com:3478', ''] }]],
    ['a web URL', [{ urls: 'https://turn.example.com' }]],
    ['a scheme that does not start the URL', [{ urls: 'https://turn:3478' }]],
    ['a turn URL without credentials', [{ urls: 'turn:turn.example.com:3478' }]],
    ['a turns URL without a username', [{ urls: 'turns:turn.example.com:5349', credential: 'hunter2' }]],
    ['a turn URL without a credential', [{ urls: 'turn:turn.example.com:3478', username: 'admin' }]],
    ['a turn URL among stun URLs, without credentials', [{ urls: ['stun:stun.example.com:3478', 'turn:turn.example.com:3478'] }]],
    ['empty credentials', [{ urls: 'turn:turn.example.com:3478', username: '', credential: '' }]],
  ])('refuses ICE servers with %s, naming only the variable', (_, servers) => {
    let message = '';
    try {
      readCallMediaConfig(on({ CALLS_MEDIA_ICE_SERVERS: JSON.stringify(servers) }), IFACES);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/CALLS_MEDIA_ICE_SERVERS/);
    expect(message).not.toMatch(/example\.com|admin|hunter2/);
  });
});

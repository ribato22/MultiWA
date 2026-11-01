// TRUST_PROXY: which address the API takes as the client's.
//
// The global ThrottlerGuard keys on req.ip. Behind nginx without trustProxy that is
// nginx's address for every caller, so all apps shared one 120/min bucket per route.
// Trusting X-Forwarded-For too far is worse: the caller could pick its own address.

import { describe, it, expect } from 'vitest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { trustProxySetting } from './app.factory';

const NGINX = '172.18.0.5'; // a Docker network address, inside 172.16.0.0/12
const CLIENT = '198.51.100.7';

async function clientIp(trustProxy: ReturnType<typeof trustProxySetting>, peer: string, forwardedFor: string): Promise<string> {
  const app = new FastifyAdapter({ trustProxy }).getInstance();
  app.get('/ip', async (req) => req.ip);
  const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress: peer, headers: { 'x-forwarded-for': forwardedFor } });
  await app.close();
  return res.body;
}

describe('trustProxySetting', () => {
  it('trusts no proxy unless TRUST_PROXY is set', async () => {
    expect(trustProxySetting(undefined)).toBe(false);
    expect(trustProxySetting(' ')).toBe(false);
    expect(trustProxySetting('false')).toBe(false);
    expect(await clientIp(trustProxySetting(undefined), NGINX, CLIENT)).toBe(NGINX);
  });

  it('takes the address the listed proxy appended, not one the caller wrote', async () => {
    // nginx appends $remote_addr to whatever X-Forwarded-For the caller sent.
    expect(await clientIp(trustProxySetting('172.16.0.0/12'), NGINX, `203.0.113.66, ${CLIENT}`)).toBe(CLIENT);
  });

  it('trusts one hop only, so a caller inside the proxy range cannot pick its address either', async () => {
    // Fastify's own list form walks on through every listed hop and would answer 203.0.113.66.
    expect(await clientIp(trustProxySetting('172.16.0.0/12'), NGINX, '203.0.113.66, 172.20.0.7')).toBe('172.20.0.7');
  });

  it('ignores X-Forwarded-For from a peer that is not a listed proxy', async () => {
    expect(await clientIp(trustProxySetting('172.16.0.0/12, 127.0.0.1'), CLIENT, '203.0.113.66')).toBe(CLIENT);
  });

  it('refuses a value that is not an address list, instead of silently trusting nothing or everything', () => {
    // A hop count is what `trust proxy` takes elsewhere; Fastify 5 ignores a number.
    for (const value of ['1', 'true', 'uniquelocal', '172.16.0.0/12,nginx']) {
      expect(() => trustProxySetting(value)).toThrow(/TRUST_PROXY/);
    }
  });
});

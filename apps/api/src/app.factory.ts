// MultiWA Gateway API - shared app configuration
// apps/api/src/app.factory.ts
//
// Applies the exact production middleware/pipe/prefix/CORS config to a Nest Fastify
// app. Shared by the real bootstrap (main.ts) and the e2e harness, so end-to-end tests
// exercise the SAME ValidationPipe (whitelist), global prefix, helmet, and multipart as
// production — the whole point of an integration test.

import { BlockList, isIP } from 'net';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';

/**
 * Fastify's `trustProxy` from TRUST_PROXY: the addresses or CIDRs of the reverse proxy
 * in front of the API, comma-separated (the stock compose's Docker networks are inside
 * 172.16.0.0/12). Unset or `false`: no proxy is trusted and req.ip is the socket peer.
 *
 * Only the hop that connects to the API is trusted, and only from a listed address, so
 * req.ip (the rate limiter's key, the address recorded at login) is the one that proxy
 * appended to X-Forwarded-For. Fastify's own list form trusts every listed hop, so a
 * caller inside the range could choose its address, and Fastify 5 ignores a hop count.
 */
export function trustProxySetting(raw = process.env.TRUST_PROXY): false | ((address: string, hop: number) => boolean) {
  const entries = (raw ?? '').split(',').map((e) => e.trim()).filter((e) => e && e !== 'false');
  if (entries.length === 0) return false;
  const proxies = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const family = isIP(address);
    if (!family) {
      throw new Error(`TRUST_PROXY: "${entry}" is not an IP address or CIDR; list the reverse proxy's, e.g. 172.16.0.0/12`);
    }
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) proxies.addAddress(address, type);
    else proxies.addSubnet(address, Number(prefix), type);
  }
  return (address, hop) => {
    const peer = address.replace(/^::ffff:/, '');
    return hop === 0 && proxies.check(peer, isIP(peer) === 6 ? 'ipv6' : 'ipv4');
  };
}

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  // File uploads
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // CSP handled by Next.js admin
    crossOriginEmbedderPolicy: false, // Allow embedding for chat widget
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  // REST API lives under /api/v1; '/' and '/metrics' stay at the root.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001'],
    credentials: true,
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  // API-wide input validation + mass-assignment defense (strip unknown fields).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}

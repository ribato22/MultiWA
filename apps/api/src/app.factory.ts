// MultiWA Gateway API - shared app configuration
// apps/api/src/app.factory.ts
//
// Applies the exact production middleware/pipe/prefix/CORS config to a Nest Fastify
// app. Shared by the real bootstrap (main.ts) and the e2e harness, so end-to-end tests
// exercise the SAME ValidationPipe (whitelist), global prefix, helmet, and multipart as
// production — the whole point of an integration test.

import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  // File uploads
  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  });

  // Security headers
  await app.register(require('@fastify/helmet'), {
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

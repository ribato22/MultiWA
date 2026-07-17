// MultiWA Gateway API - Main Entry Point
// apps/api/src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

// Fail fast on missing/weak security secrets so a production deploy can never
// silently run with a forgeable JWT secret or an ephemeral encryption key.
function validateSecurityConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const KNOWN_WEAK = new Set([
    '',
    'default-secret-change-me',
    'change-this-refresh-secret',
    'change-this-to-a-random-secret',
    'your-secure-generated-secret-key-here',
  ]);
  const crypto = require('crypto');
  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = process.env[name];
    if (!v || KNOWN_WEAK.has(v)) {
      if (isProd) {
        throw new Error(
          `${name} is missing or a known default. Set a strong value in production, e.g. \`openssl rand -base64 48\`.`,
        );
      }
      // Dev convenience: generate an ephemeral secret so local runs work, loudly.
      process.env[name] = crypto.randomBytes(48).toString('base64');
      console.warn(
        `⚠️  [security] ${name} unset/default — generated an ephemeral dev secret (tokens reset on restart). NEVER do this in production.`,
      );
    }
  }
  if (isProd && !process.env.ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY must be set in production (32-byte hex). Auto-generation is disabled because a new key on each restart makes previously-encrypted secrets undecryptable.',
    );
  }
}

async function bootstrap() {
  try {
    validateSecurityConfig();
    console.log('🔧 [1/7] Creating NestJS application...');
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: true }),
    );
    console.log('✅ [1/7] NestJS application created');

    // Register multipart for file uploads
    console.log('🔧 [2/7] Registering @fastify/multipart...');
    await app.register(require('@fastify/multipart'), {
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB max
      },
    });
    console.log('✅ [2/7] @fastify/multipart registered');

    // Security headers via Helmet
    console.log('🔧 [2.5/7] Registering @fastify/helmet...');
    await app.register(require('@fastify/helmet'), {
      contentSecurityPolicy: false, // CSP handled by Next.js admin
      crossOriginEmbedderPolicy: false, // Allow embedding for chat widget
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
      },
    });
    console.log('✅ [2.5/7] @fastify/helmet registered');

    // Global prefix for REST API
    console.log('🔧 [3/7] Setting global prefix...');
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: '/', method: RequestMethod.GET },
        // Prometheus scrapes the conventional root /metrics path.
        { path: 'metrics', method: RequestMethod.GET },
      ],
    });
    console.log('✅ [3/7] Global prefix set');

    // CORS
    console.log('🔧 [4/7] Enabling CORS...');
    app.enableCors({
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001'],
      credentials: true,
    });
    console.log('✅ [4/7] CORS enabled');

    // WebSocket adapter (socket.io)
    console.log('🔧 [5/7] Setting WebSocket adapter...');
    app.useWebSocketAdapter(new IoAdapter(app));
    console.log('✅ [5/7] WebSocket adapter set');

    // Validation
    console.log('🔧 [6/7] Setting up validation & Swagger...');
    app.useGlobalPipes(
      new ValidationPipe({
        // Strip any request-body property that isn't a validated DTO field. This is an
        // API-wide mass-assignment defense: without it, a body like {"status":"draft"}
        // or {"cursor":0} flows through `dto as any` writes into columns the client
        // should never control. `forbidNonWhitelisted` is left OFF (strip, don't reject)
        // so existing clients that send extra fields keep working.
        whitelist: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    // Swagger / OpenAPI
    const apiDescription = [
      'Self-hosted, open-source WhatsApp API gateway.',
      '',
      '## Authentication',
      'All endpoints except `/health*` require **one** of:',
      '- **Bearer JWT** — `Authorization: Bearer <token>` (obtain via `POST /auth/login`).',
      '- **API key** — `x-api-key: <key>` (create one on the dashboard API Keys page).',
      '',
      'Click **Authorize** above to try requests directly.',
      '',
      '## Recipients (`to`)',
      'Accepts a **phone number** — 7–15 digits; `+`, spaces, dashes are allowed and a local',
      '`0` prefix is normalised to the country code (e.g. `6281234567890`, `0812-3456-7890`,',
      '`+62 812 3456 7890`) — **or** a full **WhatsApp JID**: `…@s.whatsapp.net`, `…@c.us`,',
      '`…@g.us` (group), `…@lid`, `…@broadcast`, `…@newsletter`. Raw names are not accepted.',
      '',
      '## Sending model',
      'Sends are accepted asynchronously and return `201` with `status: "queued"`. A background',
      'worker delivers them while respecting per-profile rate limits; subscribe to **webhooks**',
      'or the realtime channel for delivery status (`message.sent` / `message.failed`).',
      '',
      '## Errors',
      'Conventional HTTP status codes. Validation failures return `400` with a `message` array;',
      'missing/invalid credentials return `401`; daily send-limit hits return `429`.',
    ].join('\n');

    const config = new DocumentBuilder()
      .setTitle('MultiWA Gateway API')
      .setDescription(apiDescription)
      .setVersion('3.0.0')
      .setContact('MultiWA', 'https://github.com/ribato22/MultiWA', '')
      .setLicense('MIT', 'https://github.com/ribato22/MultiWA/blob/main/LICENSE')
      .setExternalDoc('Documentation & guides', 'https://github.com/ribato22/MultiWA#readme')
      // Public-safe: default to same-origin; deployments can override with SWAGGER_SERVER_URL.
      .addServer(process.env.SWAGGER_SERVER_URL || '/', 'Current host')
      // Names kept as the @nestjs/swagger defaults so existing @ApiBearerAuth()/@ApiSecurity('api-key') keep matching.
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT access token from POST /auth/login' })
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header', description: 'API key from the dashboard API Keys page' }, 'api-key')
      .addTag('Health', 'Liveness & readiness probes (no auth required)')
      .addTag('Authentication', 'Register, login, 2FA, token refresh')
      .addTag('Messages', 'Send messages (text, media, location, poll, contact), reactions, scheduling, history')
      .addTag('Profiles', 'WhatsApp profile/session lifecycle (connect, QR, status)')
      .addTag('Webhooks', 'Event subscriptions with HMAC-signed delivery')
      .addTag('Contacts', 'Contact directory')
      .addTag('Templates', 'Reusable message templates')
      .addTag('Broadcast', 'Bulk/broadcast campaigns')
      .addTag('Automation', 'No-code automation flows')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'MultiWA Gateway API — Docs',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        displayRequestDuration: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
    console.log('✅ [6/7] Validation & Swagger configured');

    // Start server
    const port = process.env.API_PORT || 3000;
    const host = process.env.API_HOST || '0.0.0.0';
    
    console.log(`🔧 [7/7] Listening on ${host}:${port}...`);
    await app.listen(port, host);
    console.log(`🚀 MultiWA Gateway API running on http://${host}:${port}`);
    console.log(`📚 API Documentation: http://${host}:${port}/api/docs`);
    console.log(`🔌 WebSocket enabled on /socket.io/`);
  } catch (err) {
    console.error('❌ Bootstrap failed at step:', err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error('❌ Unhandled bootstrap error:', err);
  process.exit(1);
});

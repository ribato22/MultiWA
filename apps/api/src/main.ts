// MultiWA Gateway API - Main Entry Point
// apps/api/src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';

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

    // Apply the shared production config: multipart, helmet, global prefix, CORS,
    // WebSocket adapter, and the API-wide ValidationPipe (whitelist). Kept in
    // app.factory so the e2e harness boots with the identical middleware/pipe stack.
    console.log('🔧 [2-6/7] Applying app configuration...');
    await configureApp(app);
    console.log('✅ [2-6/7] App configuration applied');

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

    // Enable graceful shutdown: on SIGTERM/SIGINT Nest fires OnModuleDestroy /
    // OnApplicationShutdown so in-flight work drains (BullMQ workers/queues close,
    // engine sessions detach, DB/Redis connections release) instead of being
    // killed mid-flight. Must be enabled before listen() to register the hooks.
    app.enableShutdownHooks();

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

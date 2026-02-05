// MultiWA Gateway API - Main Entry Point
// apps/api/src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
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
    app.setGlobalPrefix('api/v1');
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
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    // Swagger
    const config = new DocumentBuilder()
      .setTitle('MultiWA Gateway API')
      .setDescription('Open Source WhatsApp Business API Gateway')
      .setVersion('3.0.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .build();
    
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
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

// apps/worker/src/main.ts
import 'reflect-metadata'; // MUST be first — required for NestJS DI decorator metadata
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import http from 'node:http';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import pino from 'pino';
import { createPrismaClient } from '@multiwa/database';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { WorkerEngineModule } from './engine/worker-engine.module';
import { EngineManagerService } from './engine/engine-manager.service';
import { WorkerMessagesService } from './engine/messages.service';
import { EngineCommandProcessor } from './engine/engine-command-processor';
import { MessageProcessor } from './processors/message.processor';
import { AutomationProcessor } from './processors/automation.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { ScheduledProcessor } from './processors/scheduled.processor';

// Nest application context + workers hosting the engine runtime (ENGINE_HOST=worker).
let nestApp: INestApplicationContext | undefined;
let engineCommandWorker: Worker | undefined;
let outboundSendWorker: Worker | undefined;

const logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: 'info' }
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      },
);

const prisma = createPrismaClient();

// Redis connection
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Initialize processors
const messageProcessor = new MessageProcessor();
const automationProcessor = new AutomationProcessor();
const webhookProcessor = new WebhookProcessor();
const scheduledProcessor = new ScheduledProcessor();

// Queues
const scheduledQueue = new Queue('scheduled', { connection });

// Workers
const messageWorker = new Worker(
  'messages',
  async (job) => messageProcessor.process(job),
  { connection, concurrency: 10 }
);

const automationWorker = new Worker(
  'automation',
  async (job) => automationProcessor.process(job),
  { connection, concurrency: 5 }
);

const webhookWorker = new Worker(
  'webhooks',
  async (job) => webhookProcessor.process(job),
  { connection, concurrency: 20 }
);

const scheduledWorker = new Worker(
  'scheduled',
  async (job) => scheduledProcessor.process(job),
  { connection, concurrency: 1 }
);

// Prometheus metrics: default Node/process metrics + BullMQ queue-depth gauges.
const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'multiwa-worker' });
collectDefaultMetrics({ register: metricsRegistry });

// Lightweight Queue handles used only to read job counts on scrape (share the
// worker's Redis connection; getJobCounts is read-only).
const metricsQueues: Record<string, Queue> = {
  messages: new Queue('messages', { connection }),
  automation: new Queue('automation', { connection }),
  webhooks: new Queue('webhooks', { connection }),
  scheduled: scheduledQueue,
};
new Gauge({
  name: 'multiwa_bullmq_jobs',
  help: 'BullMQ job counts by queue and state',
  labelNames: ['queue', 'state'],
  registers: [metricsRegistry],
  async collect() {
    for (const [name, q] of Object.entries(metricsQueues)) {
      try {
        const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        for (const [state, value] of Object.entries(counts)) {
          this.set({ queue: name, state }, value as number);
        }
      } catch {
        // Redis unavailable — skip this scrape rather than fail the endpoint.
      }
    }
  },
});

// Liveness probe (GET / — used by the Docker HEALTHCHECK; 200 only while Redis
// is ready) + Prometheus GET /metrics. The worker has no other HTTP surface.
// WORKER_HEALTH_PORT is internal (not published in compose) — scrape it from a
// Prometheus on the same network.
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT) || 3002;
const healthServer = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if ((req.url || '').startsWith('/metrics')) {
    try {
      res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
      res.end(await metricsRegistry.metrics());
    } catch {
      res.writeHead(500).end();
    }
    return;
  }
  const redisReady = connection.status === 'ready';
  res.writeHead(redisReady ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: redisReady ? 'ok' : 'degraded', redis: connection.status }));
});
healthServer.on('error', (err) => logger.error({ error: err.message }, 'Health server error'));
healthServer.listen(HEALTH_PORT, () => logger.info(`❤️  Worker health + metrics on :${HEALTH_PORT} (/, /metrics)`));

// Event handlers
messageWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, queue: 'messages' }, 'Job completed');
});

messageWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, queue: 'messages', error: err.message }, 'Job failed');
});

automationWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, queue: 'automation' }, 'Job completed');
});

automationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, queue: 'automation', error: err.message }, 'Job failed');
});

webhookWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id, queue: 'webhooks' }, 'Webhook delivered');
});

webhookWorker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, attempt: job?.attemptsMade, queue: 'webhooks', error: err.message },
    'Webhook delivery failed',
  );
});

scheduledWorker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Scheduled messages processed');
});

scheduledWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Scheduled processing failed');
});

// Schedule periodic job for checking scheduled messages (every minute)
const setupScheduledJobs = async () => {
  // Remove existing repeatable jobs to prevent duplicates
  const repeatableJobs = await scheduledQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await scheduledQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job - runs every minute
  await scheduledQueue.add(
    'check-scheduled-messages',
    { type: 'check' },
    {
      repeat: {
        every: 60000, // Every minute
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info('📅 Scheduled message check job registered (every 1 minute)');
};

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down workers...');
  healthServer.close();
  await Promise.all([
    messageWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
    scheduledWorker.close(),
    scheduledQueue.close(),
    // Metrics-only queue handles (scheduledQueue is closed above).
    metricsQueues.messages.close(),
    metricsQueues.automation.close(),
    metricsQueues.webhooks.close(),
  ]);
  if (engineCommandWorker) await engineCommandWorker.close();
  if (outboundSendWorker) await outboundSendWorker.close();
  if (nestApp) await nestApp.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start workers
const start = async () => {
  // Test database connection
  await prisma.$connect();
  logger.info('📦 Database connected');

  // When the engine is hosted in the worker, bootstrap the Nest context that
  // provides the engine runtime (RealtimeEmitter, send gate, and — as they
  // relocate — EngineManager/RuleEngine/Messages/etc.). Inert when ENGINE_HOST=api.
  if (process.env.ENGINE_HOST === 'worker') {
    nestApp = await NestFactory.createApplicationContext(WorkerEngineModule, {
      logger: ['warn', 'error', 'log'],
    });
    await nestApp.init();
    logger.info('🧩 Worker engine Nest context initialized (ENGINE_HOST=worker)');

    const engineManager = nestApp.get(EngineManagerService);
    const messages = nestApp.get(WorkerMessagesService);
    const commandProcessor = new EngineCommandProcessor(engineManager);

    // API -> worker engine commands (connect/disconnect/status/group/contacts/etc.)
    engineCommandWorker = new Worker(
      'engine-commands',
      (job) => commandProcessor.process(job),
      {
        connection,
        concurrency: 20,
        lockDuration: parseInt(process.env.WORKER_COMMAND_TIMEOUT_MS ?? '30000', 10) + 10000,
      },
    );
    engineCommandWorker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, name: job?.name, error: err.message }, 'Engine command failed');
    });

    // Durable outbound sends drained through the per-profile send gate. Concurrency
    // 1 keeps strict FIFO; per-profile pacing is enforced by the gate itself.
    const OUTBOUND_ATTEMPTS = 3;
    outboundSendWorker = new Worker(
      'outbound-send',
      async (job) => {
        const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? OUTBOUND_ATTEMPTS);
        await messages.deliverQueued(job.data, isLastAttempt);
      },
      { connection, concurrency: 1 },
    );
    outboundSendWorker.on('failed', (job, err) => {
      logger.warn({ jobId: job?.id, attempt: job?.attemptsMade, error: err.message }, 'Queued send failed');
    });

    logger.info('🛰️  Engine command + outbound send workers started (ENGINE_HOST=worker)');
  }

  await setupScheduledJobs();

  logger.info('🚀 Workers started');
  logger.info('📨 Message queue: concurrency 10');
  logger.info('🤖 Automation queue: concurrency 5');
  logger.info('🔔 Webhook queue: concurrency 20');
  logger.info('📅 Scheduled queue: concurrency 1');
};

start().catch((err) => {
  logger.error({ error: err.message }, 'Failed to start workers');
  process.exit(1);
});

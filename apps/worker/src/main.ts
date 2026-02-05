// apps/worker/src/main.ts
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import { MessageProcessor } from './processors/message.processor';
import { AutomationProcessor } from './processors/automation.processor';
import { WebhookProcessor } from './processors/webhook.processor';
import { ScheduledProcessor } from './processors/scheduled.processor';

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

const prisma = new PrismaClient();

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
  logger.error({ jobId: job?.id, queue: 'webhooks', error: err.message }, 'Webhook failed');
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
  await Promise.all([
    messageWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
    scheduledWorker.close(),
    scheduledQueue.close(),
  ]);
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

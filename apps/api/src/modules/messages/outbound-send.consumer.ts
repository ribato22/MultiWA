// MultiWA Gateway - Durable outbound send consumer (in-API)
// apps/api/src/modules/messages/outbound-send.consumer.ts
//
// Runs a BullMQ Worker INSIDE the API process so the WhatsApp engine (which is
// process-local to the API) is reachable while sends are durable. Only active
// when DURABLE_SEND=true; otherwise a no-op (the synchronous send path is used).

import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { MessagesService } from './messages.service';
import { OUTBOUND_SEND_MAX_ATTEMPTS, OutboundSendJob, isDurableSend } from './outbound-send';

@Injectable()
export class OutboundSendConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundSendConsumer.name);
  private worker?: Worker;
  private connection?: IORedis;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messagesService: MessagesService,
  ) {}

  onModuleInit(): void {
    if (!isDurableSend()) {
      this.logger.log('DURABLE_SEND not enabled; outbound send consumer idle (synchronous send path active)');
      return;
    }

    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });

    // Concurrency >1 is safe: SendGateService serializes per-profile in-process,
    // so cross-profile sends parallelize without head-of-line blocking, while
    // same-profile sends stay ordered and paced.
    const concurrency = parseInt(this.config.get<string>('OUTBOUND_SEND_CONCURRENCY') ?? '10', 10);

    this.worker = new Worker<OutboundSendJob>(
      'outbound-send',
      async (job) => {
        const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? OUTBOUND_SEND_MAX_ATTEMPTS);
        await this.messagesService.deliverQueued(job.data, isLastAttempt);
      },
      { connection: this.connection, concurrency },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `Queued send failed (attempt ${job?.attemptsMade}) for message ${job?.data?.messageDbId}: ${err.message}`,
      );
    });

    this.logger.log(`Durable outbound send consumer started (concurrency ${concurrency})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}

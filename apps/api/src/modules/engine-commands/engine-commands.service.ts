// MultiWA Gateway - Engine Commands client (API -> worker)
// apps/api/src/modules/engine-commands/engine-commands.service.ts
//
// When ENGINE_HOST=worker, the engine runs in apps/worker. The API delegates
// engine operations over the BullMQ 'engine-commands' queue. Result-bearing
// commands (connect/disconnect/status/group/contacts/call) use request/reply via
// QueueEvents.waitUntilFinished; presence/read/delete are fire-and-forget.
// See architecture/engine-worker-migration-sop.md.

import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { isWorkerEngine } from '../../common/engine-host';

export const ENGINE_COMMANDS_QUEUE = 'ENGINE_COMMANDS_QUEUE';

// Result-bearing command timeouts (ms). Keep <= the worker's engine-commands
// lockDuration (WORKER_COMMAND_TIMEOUT_MS + 10 s, 40 s by default) so a long op is not re-queued mid-flight.
// `call` sits between the runtime's bound on an agent's reject (AGENT_REJECT_TIMEOUT_MS, 25 s) and the 30 s CallsService
// gives the whole request: the runtime lets go of the call first, and its ENGINE_TIMEOUT reaches the agent as the
// failure of the command, instead of the API giving up while the worker still holds the call.
const TIMEOUTS = {
  connect: 60_000,
  disconnect: 15_000,
  status: 5_000,
  group: 45_000,
  contacts: 60_000,
  call: 28_000,
} as const;

@Injectable()
export class EngineCommandsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineCommandsService.name);
  private queueEvents?: QueueEvents;
  private qeConnection?: IORedis;

  constructor(
    @Inject(ENGINE_COMMANDS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isWorkerEngine()) return; // API hosts the engine; no command client needed.
    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.qeConnection = new IORedis(url, { maxRetriesPerRequest: null });
    this.queueEvents = new QueueEvents('engine-commands', { connection: this.qeConnection });
    await this.queueEvents.waitUntilReady();
    this.logger.log('Engine commands client ready (ENGINE_HOST=worker)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
    await this.qeConnection?.quit();
  }

  // ---- result-bearing commands ----
  connectProfile(profileId: string) {
    return this.request('connect-profile', { profileId }, TIMEOUTS.connect);
  }
  disconnectProfile(profileId: string) {
    return this.request('disconnect-profile', { profileId }, TIMEOUTS.disconnect);
  }
  getEngineStatus(profileId: string) {
    return this.request('get-status', { profileId }, TIMEOUTS.status);
  }
  groupOp(profileId: string, op: string, params: any) {
    return this.request('group-op', { profileId, op, params }, TIMEOUTS.group);
  }
  contactsSync(profileId: string) {
    return this.request('contacts-sync', { profileId }, TIMEOUTS.contacts);
  }
  rejectCall(profileId: string, callId: string) {
    return this.request('reject-call', { profileId, callId }, TIMEOUTS.call);
  }
  createCallLink(profileId: string, type: 'voice' | 'video') {
    return this.request<string | null>('create-call-link', { profileId, type }, TIMEOUTS.call);
  }

  // ---- fire-and-forget commands ----
  presenceUpdate(profileId: string, to: string, state: string) {
    return this.fire('presence-update', { profileId, to, state });
  }
  markRead(profileId: string, chatId: string, messageIds?: string[]) {
    return this.fire('mark-read', { profileId, chatId, messageIds });
  }
  deleteForEveryone(profileId: string, chatId: string, messageId: string) {
    return this.fire('delete-for-everyone', { profileId, chatId, messageId });
  }

  private async request<T = any>(name: string, data: { profileId: string; [k: string]: any }, timeoutMs: number): Promise<T> {
    if (!this.queueEvents) {
      throw new ServiceUnavailableException('Engine command client not ready (ENGINE_HOST must be "worker")');
    }
    const job = await this.queue.add(name, data, {
      jobId: this.jobId(name, data),
      attempts: 1,
      // Keep the completed/failed job briefly so waitUntilFinished can read the
      // result, then auto-clean (avoids unbounded growth; not `false`).
      removeOnComplete: { age: 120, count: 1000 },
      removeOnFail: { age: 600, count: 1000 },
    });
    return job.waitUntilFinished(this.queueEvents, timeoutMs) as Promise<T>;
  }

  /**
   * BullMQ drops a job whose id exists, so two commands of one millisecond with the same id would be one job and the
   * second request would be answered with the result of the first. A reject names its call, a call link (which has
   * nothing to tell requests apart) gets a random part; the time stays in both, so asking again after a failure is a new job.
   */
  private jobId(name: string, data: { profileId: string; [k: string]: any }): string {
    const base = `${name}-${data.profileId}`;
    if (name === 'reject-call') return `${base}-${data.callId}-${Date.now()}`;
    if (name === 'create-call-link') return `${base}-${Date.now()}-${randomUUID()}`;
    return `${base}-${Date.now()}`;
  }

  private async fire(name: string, data: Record<string, any>): Promise<void> {
    await this.queue.add(name, data, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 600, count: 500 },
    });
  }
}

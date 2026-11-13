// apps/worker/src/instrument.ts
// Sentry, when SENTRY_DSN is set; main.ts imports this right after reflect-metadata. What is sent, and what never
// is: @multiwa/engine-runtime's sentry.ts.
import * as Sentry from '@sentry/node';
import type { Job } from 'bullmq';
import { sentryOptions } from '@multiwa/engine-runtime';

const options = sentryOptions('worker', __dirname);
if (options) Sentry.init(options);

/**
 * A job's last failed attempt goes to Sentry, tagged with its queue. One BullMQ will retry does not, so a webhook
 * target that is down for a minute reports once, not on every attempt. A no-op without SENTRY_DSN.
 */
export function reportFinalFailure(queue: string, job: Job | undefined, err: Error): void {
  if (job && job.attemptsMade < (job.opts.attempts ?? 1)) return;
  Sentry.captureException(err, { tags: { queue }, extra: { jobId: job?.id, attempts: job?.attemptsMade } });
}

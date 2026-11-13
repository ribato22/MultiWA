// A job's last failed attempt goes to Sentry; one BullMQ will retry does not.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import type { Job } from 'bullmq';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/node', () => ({ init: vi.fn(), captureException }));

import { reportFinalFailure } from './instrument';

const job = (attemptsMade: number, attempts?: number) =>
  ({ id: 'job-1', attemptsMade, opts: attempts === undefined ? {} : { attempts } }) as unknown as Job;

describe('reportFinalFailure', () => {
  beforeEach(() => captureException.mockReset());

  it("reports a job's last failed attempt, tagged with its queue", () => {
    const err = new Error('the webhook target answered 503');
    reportFinalFailure('webhooks', job(5, 5), err);
    expect(captureException).toHaveBeenCalledWith(err, { tags: { queue: 'webhooks' }, extra: { jobId: 'job-1', attempts: 5 } });
  });

  it('does not report an attempt BullMQ will retry', () => {
    reportFinalFailure('webhooks', job(2, 5), new Error('503'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports a job without retries at its first failure, and a failure that has no job', () => {
    reportFinalFailure('messages', job(1), new Error('a'));
    reportFinalFailure('scheduled', undefined, new Error('b'));
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it('main.ts loads it right after reflect-metadata, before the rest', () => {
    const imports = readFileSync(path.join(__dirname, 'main.ts'), 'utf8').split('\n').filter((l) => l.startsWith('import '));
    expect(imports.slice(0, 2)).toEqual([
      "import 'reflect-metadata'; // MUST be first — required for NestJS DI decorator metadata",
      "import { reportFinalFailure } from './instrument'; // Sentry next, before the rest is loaded",
    ]);
  });
});

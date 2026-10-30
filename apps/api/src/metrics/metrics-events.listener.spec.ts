// Unit tests for MetricsEventsListener — event → metric wiring + DB resync,
// with MetricsService and prisma mocked (no database).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { profile: { count: vi.fn() } },
}));

import { prisma } from '@multiwa/database';
import { MetricsEventsListener } from './metrics-events.listener';
import { MetricsService } from './metrics.service';

function makeMetrics() {
  return {
    messagesSentTotal: { inc: vi.fn() },
    messagesFailedTotal: { inc: vi.fn() },
    connectedProfiles: { inc: vi.fn(), dec: vi.fn(), set: vi.fn() },
    callsMediaWorkerDeathsTotal: { inc: vi.fn() },
  } as any;
}

describe('MetricsEventsListener', () => {
  let metrics: ReturnType<typeof makeMetrics>;
  let listener: MetricsEventsListener;

  beforeEach(() => {
    vi.mocked(prisma.profile.count).mockReset();
    metrics = makeMetrics();
    listener = new MetricsEventsListener(metrics);
  });

  it('resyncs the connected-profiles gauge from the DB on init', async () => {
    vi.mocked(prisma.profile.count).mockResolvedValueOnce(3 as any);
    await listener.onModuleInit();
    expect(prisma.profile.count).toHaveBeenCalledWith({ where: { status: 'connected' } });
    expect(metrics.connectedProfiles.set).toHaveBeenCalledWith(3);
  });

  it('swallows a DB error during resync (never throws)', async () => {
    vi.mocked(prisma.profile.count).mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onModuleInit()).resolves.toBeUndefined();
    expect(metrics.connectedProfiles.set).not.toHaveBeenCalled();
  });

  it('counts sent/failed by type and adjusts the gauge on connect/disconnect', () => {
    listener.onMessageSent({ type: 'text' });
    expect(metrics.messagesSentTotal.inc).toHaveBeenCalledWith({ type: 'text' });

    listener.onMessageFailed({ type: 'image' });
    expect(metrics.messagesFailedTotal.inc).toHaveBeenCalledWith({ type: 'image' });

    listener.onMessageSent({}); // missing type falls back
    expect(metrics.messagesSentTotal.inc).toHaveBeenCalledWith({ type: 'unknown' });

    listener.onConnectionReady();
    expect(metrics.connectedProfiles.inc).toHaveBeenCalledOnce();

    listener.onConnectionDisconnected();
    expect(metrics.connectedProfiles.dec).toHaveBeenCalledOnce();
  });

  it('counts a death of the call media worker', () => {
    listener.onCallsMediaWorkerDied({ calls: 2 });
    expect(metrics.callsMediaWorkerDeathsTotal.inc).toHaveBeenCalledTimes(1);
  });
});

// On a real registry: the series names and labels are what the alerts and dashboards read.
describe('MetricsEventsListener: the dashboard call counters', () => {
  let metrics: MetricsService;
  let listener: MetricsEventsListener;

  beforeEach(() => {
    metrics = new MetricsService();
    listener = new MetricsEventsListener(metrics);
  });

  it('counts the dashboard calls: rings, answers with their speed, media failures and ends by reason', async () => {
    listener.onCallsSession({ kind: 'rung', agents: 3 });
    listener.onCallsSession({ kind: 'answered', answerSeconds: 4.2 });
    listener.onCallsSession({ kind: 'media_failed', reason: 'connect_timeout' });
    listener.onCallsSession({ kind: 'ended', endReason: 'hangup' });
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/multiwa_calls_dashboard_rings_total\{app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_dashboard_answers_total\{app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_dashboard_answer_seconds_count\{app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_media_failures_total\{reason="connect_timeout",app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_dashboard_ended_total\{reason="hangup",app="multiwa-api"\} 1/);
  });
});

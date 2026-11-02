// Unit tests for MetricsEventsListener — event → metric wiring + DB resync,
// with MetricsService and prisma mocked (no database).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@multiwa/database', () => ({
  prisma: { profile: { count: vi.fn(), findMany: vi.fn() } },
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
    vi.mocked(prisma.profile.findMany).mockReset();
    metrics = makeMetrics();
    listener = new MetricsEventsListener(metrics);
  });

  it('resyncs the connected-profiles gauge from the DB on init', async () => {
    vi.mocked(prisma.profile.findMany).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any);
    await listener.onModuleInit();
    expect(prisma.profile.findMany).toHaveBeenCalledWith({ where: { status: 'connected' }, select: { id: true } });
    expect(metrics.connectedProfiles.set).toHaveBeenCalledWith(3);
  });

  // A profile that reconnects after a transient drop (an engine recycle) becomes ready again with no
  // disconnect event in between: counting events let the gauge climb, so "all profiles down" (== 0) went blind.
  it('counts a profile once however often it becomes ready, and drops it on disconnect', async () => {
    vi.mocked(prisma.profile.findMany).mockResolvedValueOnce([{ id: 'p1' }] as any);
    await listener.onModuleInit();
    listener.onConnectionReady({ profileId: 'p1' });
    listener.onConnectionReady({ profileId: 'p1' });
    expect(metrics.connectedProfiles.set).toHaveBeenLastCalledWith(1);
    listener.onConnectionReady({ profileId: 'p2' });
    expect(metrics.connectedProfiles.set).toHaveBeenLastCalledWith(2);
    listener.onConnectionDisconnected({ profileId: 'p1' });
    expect(metrics.connectedProfiles.set).toHaveBeenLastCalledWith(1);
  });

  it('swallows a DB error during resync (never throws)', async () => {
    vi.mocked(prisma.profile.findMany).mockRejectedValueOnce(new Error('db down'));
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

    listener.onConnectionReady({ profileId: 'p1' });
    expect(metrics.connectedProfiles.set).toHaveBeenLastCalledWith(1);

    listener.onConnectionDisconnected({ profileId: 'p1' });
    expect(metrics.connectedProfiles.set).toHaveBeenLastCalledWith(0);
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
    listener.onCallsSession({ kind: 'rung' });
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

  // A nightly check would otherwise create not_private already at 1, and an increase(...) > 0 alert never fires on it.
  it('exposes every privacy check result at 0 before the first check', async () => {
    const text = await metrics.registry.metrics();
    for (const result of ['ok', 'not_private', 'check_failed']) {
      expect(text).toMatch(new RegExp(`^multiwa_calls_recordings_privacy_checks_total\\{result="${result}",app="multiwa-api"\\} 0$`, 'm'));
    }
  });

  it('counts the privacy checks of the recordings storage by result', async () => {
    listener.onCallRecordingsPrivacy({ result: 'ok' });
    listener.onCallRecordingsPrivacy({ result: 'not_private' });
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/multiwa_calls_recordings_privacy_checks_total\{result="ok",app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_recordings_privacy_checks_total\{result="not_private",app="multiwa-api"\} 1/);
  });

  it('exposes every recording upload result and recorder failure at 0 before the first', async () => {
    const text = await metrics.registry.metrics();
    for (const result of ['ok', 'failed']) {
      expect(text).toMatch(new RegExp(`^multiwa_calls_recording_uploads_total\\{result="${result}",app="multiwa-api"\\} 0$`, 'm'));
    }
    for (const stage of ['start', 'announcement']) {
      expect(text).toMatch(new RegExp(`^multiwa_calls_recorder_failures_total\\{stage="${stage}",app="multiwa-api"\\} 0$`, 'm'));
    }
  });

  it('counts the recordings stored and not, and the calls left unrecorded by why', async () => {
    listener.onCallRecorder({ kind: 'upload', result: 'ok' });
    listener.onCallRecorder({ kind: 'upload', result: 'failed' });
    listener.onCallRecorder({ kind: 'failed', stage: 'announcement' });
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/multiwa_calls_recording_uploads_total\{result="ok",app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_recording_uploads_total\{result="failed",app="multiwa-api"\} 1/);
    expect(text).toMatch(/multiwa_calls_recorder_failures_total\{stage="announcement",app="multiwa-api"\} 1/);
  });

  it('labels its series from closed sets: a reason outside them does not compile', () => {
    // @ts-expect-error: not a media failure reason
    listener.onCallsSession({ kind: 'media_failed', reason: 'timeout' });
    // @ts-expect-error: not an end reason
    listener.onCallsSession({ kind: 'ended', endReason: 'bye' });
    // @ts-expect-error: not a privacy check result
    listener.onCallRecordingsPrivacy({ result: 'public' });
    // @ts-expect-error: not an upload result
    listener.onCallRecorder({ kind: 'upload', result: 'maybe' });
    // @ts-expect-error: not a recorder stage
    listener.onCallRecorder({ kind: 'failed', stage: 'upload' });
  });
});

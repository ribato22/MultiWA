// The nightly job, and the reaction to a public storage. Any check that finds the storage public (the nightly one, or
// an admin turning recording on) turns recording off everywhere and alerts; with nothing left to turn off, the alert
// repeats at most every 20 hours. The nightly check that proves nothing only alerts. Retention and the sweep run after
// it; one step failing does not skip the others.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../profiles/profile-settings', () => ({ turnRecordingOffEverywhere: vi.fn() }));
vi.mock('../coordinator/call-alerts', () => ({ CallAlerts: class {} }));
vi.mock('./call-recordings.service', () => ({ CallRecordingsService: class {} }));

import { turnRecordingOffEverywhere } from '../../profiles/profile-settings';
import { CallRecordingsCron } from './call-recordings.cron';

const NOW = new Date('2026-10-31T19:30:00Z');
const HOUR = 60 * 60 * 1000;
const turnOff = vi.mocked(turnRecordingOffEverywhere);

function make() {
  const recordings = {
    checkStorage: vi.fn().mockResolvedValue({ ok: true }),
    profilesConcerned: vi.fn().mockResolvedValue({ recording: ['p1', 'p2'], stored: ['p2', 'p3'] }),
    applyRetention: vi.fn().mockResolvedValue(0),
    sweepOrphans: vi.fn().mockResolvedValue(0),
  };
  const alerts = { recordingStorage: vi.fn().mockResolvedValue(undefined) };
  return { recordings, alerts, cron: new CallRecordingsCron(recordings as any, alerts as any) };
}

beforeEach(() => {
  turnOff.mockReset().mockResolvedValue(['p1', 'p2']);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('CallRecordingsCron', () => {
  it('runs at 02:30 on the server clock (no time zone of its own)', () => {
    const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', CallRecordingsCron.prototype.nightly);
    expect(options).toMatchObject({ cronTime: '30 2 * * *' });
    expect(options.timeZone).toBeUndefined();
  });

  it('a private storage: retention and the sweep run, nobody is alerted', async () => {
    const { cron, recordings, alerts } = make();
    await cron.run(NOW);
    expect(recordings.checkStorage).toHaveBeenCalledWith(NOW);
    expect(recordings.applyRetention).toHaveBeenCalledWith(NOW);
    expect(recordings.sweepOrphans).toHaveBeenCalledWith(NOW);
    expect(alerts.recordingStorage).not.toHaveBeenCalled();
  });

  it('a public storage found by the nightly check is left to the event: the run itself alerts nobody', async () => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue({ ok: false, reason: 'storage_not_private', detail: 'x' });
    await cron.run(NOW);
    expect(turnOff).not.toHaveBeenCalled();
    expect(alerts.recordingStorage).not.toHaveBeenCalled();
    expect(recordings.applyRetention).toHaveBeenCalled(); // deleting old recordings only helps
  });

  it('any check that finds the storage public: recording off everywhere, then one alert for every profile concerned', async () => {
    const { cron, alerts } = make();
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(turnOff).toHaveBeenCalledTimes(1);
    expect(alerts.recordingStorage).toHaveBeenCalledWith('not_private', ['p1', 'p2', 'p3'], ['p1', 'p2']);
  });

  it('found public again with nothing left to turn off: the alert repeats at most every 20 hours', async () => {
    const { cron, alerts } = make();
    await cron.onPrivacyCheck({ result: 'not_private' });
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + 19 * HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW.getTime() + 21 * HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2);
    expect(alerts.recordingStorage).toHaveBeenLastCalledWith('not_private', ['p2', 'p3'], []);
  });

  // Turned on again while the storage passed its check, then found public again: the admins must hear of it at once.
  it('a check that turns recording off again is alerted at once, within the 20 hours too', async () => {
    const { cron, alerts } = make();
    await cron.onPrivacyCheck({ result: 'not_private' });
    turnOff.mockResolvedValue(['p1']);
    vi.setSystemTime(NOW.getTime() + HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2);
    expect(alerts.recordingStorage).toHaveBeenLastCalledWith('not_private', ['p1', 'p2', 'p3'], ['p1']);
  });

  it('a check that passed, or proved nothing, is not a public storage', async () => {
    const { cron, alerts } = make();
    await cron.onPrivacyCheck({ result: 'ok' });
    await cron.onPrivacyCheck({ result: 'check_failed' });
    expect(turnOff).not.toHaveBeenCalled();
    expect(alerts.recordingStorage).not.toHaveBeenCalled();
  });

  it('the reaction never throws: an event handler that rejects would be an unhandled rejection', async () => {
    const { cron } = make();
    turnOff.mockRejectedValue(new Error('db down'));
    await expect(cron.onPrivacyCheck({ result: 'not_private' })).resolves.toBeUndefined();
  });

  it('a nightly check that proved nothing: recording stays on, the profiles that record are alerted', async () => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue({ ok: false, reason: 'storage_check_failed', detail: 'timeout' });
    await cron.run(NOW);
    expect(turnOff).not.toHaveBeenCalled();
    expect(alerts.recordingStorage).toHaveBeenCalledWith('check_failed', ['p1', 'p2'], []);
  });

  it('no storage configured: nothing to check, nobody alerted', async () => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue({ ok: false, reason: 'recordings_storage_unset', detail: 'x' });
    await cron.run(NOW);
    expect(alerts.recordingStorage).not.toHaveBeenCalled();
    expect(recordings.sweepOrphans).toHaveBeenCalled();
  });

  it('one step failing does not skip the others', async () => {
    const { cron, recordings } = make();
    recordings.checkStorage.mockRejectedValue(new Error('db down'));
    recordings.applyRetention.mockRejectedValue(new Error('db down'));
    await expect(cron.run(NOW)).resolves.toBeUndefined();
    expect(recordings.sweepOrphans).toHaveBeenCalledWith(NOW);
  });
});

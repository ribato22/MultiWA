// The nightly job, and the reaction to a public storage. Any check that finds the storage public (the nightly one, or
// an admin turning recording on) turns recording off everywhere, logs the profiles turned off, and alerts; with nothing
// left to turn off, the alert repeats at most every 20 hours, counted from an alert that told someone. The nightly check
// that proves nothing only alerts. Profiles that record on a server whose recordings storage is not set up are reminded
// of each night. Retention and the sweep run after it; one step failing does not skip the others.
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { InternalEvents } from '../../../metrics/internal-events';

vi.mock('../../profiles/profile-settings', () => ({ turnRecordingOffEverywhere: vi.fn() }));
vi.mock('../coordinator/call-alerts', () => ({ CallAlerts: class {} }));
vi.mock('./call-recordings.service', () => ({ CallRecordingsService: class {} }));
vi.mock('./call-recorder.service', () => ({ CallRecorderService: class {} }));

import { turnRecordingOffEverywhere } from '../../profiles/profile-settings';
import { CallRecordingsCron } from './call-recordings.cron';

const NOW = new Date('2026-10-31T19:30:00Z');
const HOUR = 60 * 60 * 1000;
const turnOff = vi.mocked(turnRecordingOffEverywhere);

function make() {
  const recordings = {
    checkStorage: vi.fn().mockResolvedValue({ ok: true }),
    storageStatus: vi.fn().mockReturnValue({ problem: null }),
    profilesConcerned: vi.fn().mockResolvedValue({ recording: ['p1', 'p2'], stored: ['p2', 'p3'] }),
    applyRetention: vi.fn().mockResolvedValue(0),
    sweepOrphans: vi.fn().mockResolvedValue(0),
  };
  // Resolves whether a bell went out.
  const alerts = { recordingStorage: vi.fn().mockResolvedValue(true) };
  const recorder = { finishLeftovers: vi.fn().mockResolvedValue({ stored: 0, kept: 0, discarded: 0 }) };
  return { recordings, alerts, recorder, cron: new CallRecordingsCron(recordings as any, alerts as any, recorder as any) };
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

  // The only link from a check that finds the storage public to the turn-off and the alert: without it, a public
  // storage would be logged, and nothing turned off and nobody told.
  it('reacts to every privacy check, and listens to nothing else', () => {
    const proto = CallRecordingsCron.prototype as any;
    const listening = Object.fromEntries(
      Object.getOwnPropertyNames(proto)
        .map((name): [string, Array<{ event: string }> | undefined] => [name, Reflect.getMetadata(EVENT_LISTENER_METADATA, proto[name])])
        .filter(([, listeners]) => listeners)
        .map(([name, listeners]) => [name, listeners!.map((l) => l.event)]),
    );
    expect(listening).toEqual({ onPrivacyCheck: [InternalEvents.CALL_RECORDINGS_PRIVACY] });
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

  // Nest's listener wrapper would log a rejection by its bare message: the try/catch gives the error its own.
  it('the reaction never throws, and logs what failed', async () => {
    const { cron } = make();
    const error = vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
    turnOff.mockRejectedValue(new Error('db\ndown'));
    await expect(cron.onPrivacyCheck({ result: 'not_private' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('The reaction to a public call recordings storage failed: dbdown');
  });

  // Logged before the alert: if the alert fails, the next check turns nothing off, and the log is all that says which.
  it('names the profiles it turned off in the log, also when the alert then fails', async () => {
    const { cron, alerts } = make();
    const warn = vi.spyOn((cron as any).logger, 'warn').mockImplementation(() => {});
    vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
    alerts.recordingStorage.mockRejectedValue(new Error('db down'));
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(warn.mock.calls).toEqual([['The call recordings storage serves its files without credentials: recording was turned off for p1, p2']]);
    turnOff.mockResolvedValue([]);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(warn).toHaveBeenCalledTimes(1); // nothing turned off, nothing to name
  });

  it('an alert that failed starts no 20-hour window: the next check alerts, nothing left to turn off', async () => {
    const { cron, alerts } = make();
    vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
    alerts.recordingStorage.mockRejectedValueOnce(new Error('db down'));
    await cron.onPrivacyCheck({ result: 'not_private' });
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2);
  });

  // Two checks at once (the nightly one and an admin's): the first one's alert fails after the second one's went out.
  it("an alert that fails after another check's went out keeps that one's window", async () => {
    const { cron, alerts } = make();
    vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
    let fail!: (e: Error) => void;
    const alerting = new Promise<void>((reached) => {
      alerts.recordingStorage.mockImplementationOnce(() => {
        reached();
        return new Promise((_, reject) => (fail = reject));
      });
    });
    const first = cron.onPrivacyCheck({ result: 'not_private' });
    await alerting;
    turnOff.mockResolvedValue(['p3']); // turned on since: alerted at once
    vi.setSystemTime(NOW.getTime() + HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    fail(new Error('db down'));
    await first;
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + 2 * HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2); // within 20 hours of the second check's alert
  });

  // The other order: the first check's turn-off answers after the second check's alert went out, and its own then fails.
  it("an alert that fails after another check's went out keeps that one's window, also when it was started first", async () => {
    const { cron, alerts } = make();
    vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
    let answer!: (ids: string[]) => void;
    turnOff.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    alerts.recordingStorage.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('db down'));
    const first = cron.onPrivacyCheck({ result: 'not_private' });
    await cron.onPrivacyCheck({ result: 'not_private' }); // its alert went out
    vi.setSystemTime(NOW.getTime() + HOUR);
    answer(['p3']);
    await first;
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + 2 * HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2); // within 20 hours of the second check's alert
  });

  // Every bell failed (the database failing after the profiles were read): the alert resolved, but told nobody.
  it('an alert that reached nobody starts no 20-hour window either: the next check alerts, nothing left to turn off', async () => {
    const { cron, alerts } = make();
    alerts.recordingStorage.mockResolvedValueOnce(false);
    await cron.onPrivacyCheck({ result: 'not_private' });
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2);
  });

  it("an alert that reached nobody after another check's went out keeps that one's window", async () => {
    const { cron, alerts } = make();
    let answer!: (told: boolean) => void;
    const alerting = new Promise<void>((reached) => {
      alerts.recordingStorage.mockImplementationOnce(() => {
        reached();
        return new Promise((resolve) => (answer = resolve));
      });
    });
    const first = cron.onPrivacyCheck({ result: 'not_private' });
    await alerting;
    turnOff.mockResolvedValue(['p3']); // turned on since: alerted at once
    vi.setSystemTime(NOW.getTime() + HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    answer(false);
    await first;
    turnOff.mockResolvedValue([]);
    vi.setSystemTime(NOW.getTime() + 2 * HOUR);
    await cron.onPrivacyCheck({ result: 'not_private' });
    expect(alerts.recordingStorage).toHaveBeenCalledTimes(2); // within 20 hours of the second check's alert
  });

  it('a nightly check that proved nothing: recording stays on, the profiles that record are alerted', async () => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue({ ok: false, reason: 'storage_check_failed', detail: 'timeout' });
    await cron.run(NOW);
    expect(turnOff).not.toHaveBeenCalled();
    expect(alerts.recordingStorage).toHaveBeenCalledWith('check_failed', ['p1', 'p2'], []);
  });

  it('no storage configured and no profile recording: nothing to check, nobody alerted', async () => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue({ ok: false, reason: 'recordings_storage_unset', detail: 'x' });
    recordings.storageStatus.mockReturnValue({ problem: 'CALL_RECORDINGS_PATH is not set' });
    recordings.profilesConcerned.mockResolvedValue({ recording: [], stored: ['p3'] });
    await cron.run(NOW);
    expect(alerts.recordingStorage).not.toHaveBeenCalled();
    expect(recordings.sweepOrphans).toHaveBeenCalled();
  });

  // Lost after recording was turned on (an env or compose change at a redeploy): the recorder plans no recording, the
  // calls ring unrecorded, and only GET /calls/media/status says why. Each night until it is set up again.
  it.each([
    ['the storage', { ok: false, reason: 'recordings_storage_unset', detail: 'x' }, 'CALL_RECORDINGS_PATH is not set'],
    ['CALL_RECORDINGS_TMP', { ok: true }, 'CALL_RECORDINGS_TMP is not set'],
  ])('%s not set up while profiles record: the admins of those profiles are reminded', async (_what, check, problem) => {
    const { cron, recordings, alerts } = make();
    recordings.checkStorage.mockResolvedValue(check);
    recordings.storageStatus.mockReturnValue({ problem });
    await cron.run(NOW);
    expect(alerts.recordingStorage.mock.calls).toEqual([['unset', ['p1', 'p2'], []]]);
  });

  // After the check: a recording is never stored to a storage that check found public. Before the sweep: a recording
  // stored now is no orphan.
  it('finishes the recordings left over after the privacy check, and before retention and the sweep', async () => {
    const { cron, recordings, recorder } = make();
    await cron.run(NOW);
    expect(recorder.finishLeftovers).toHaveBeenCalledWith(NOW);
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(order(recordings.checkStorage)).toBeLessThan(order(recorder.finishLeftovers));
    expect(order(recorder.finishLeftovers)).toBeLessThan(order(recordings.applyRetention));
    expect(order(recorder.finishLeftovers)).toBeLessThan(order(recordings.sweepOrphans));
  });

  it('a failure there skips nothing else', async () => {
    const { cron, recordings, recorder } = make();
    recorder.finishLeftovers.mockRejectedValue(new Error('EACCES'));
    await cron.run(NOW);
    expect(recordings.applyRetention).toHaveBeenCalled();
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

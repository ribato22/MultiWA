// The recorder with a fake engine (it hands the fixture recording over as chunks), the store in memory and Prisma
// mocked: record first, the announcement next, then the agent; every failure leaves the call unrecorded, connected,
// and the admins told; the end stops, then keeps the recording in the background (its length written in, four tries,
// its row, call.recording.ready). The real page is in call-session.integration.spec.ts; a real Postgres in
// test/call-recordings.e2e-spec.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';

vi.mock('@multiwa/database', () => ({ prisma: { callRecording: { create: vi.fn(), findUnique: vi.fn() }, call: { findUnique: vi.fn() } } }));
vi.mock('../coordinator/call-alerts', () => ({ CallAlerts: class {} }));
vi.mock('./call-recordings.service', () => ({ CallRecordingsService: class {} }));
// The real listing and deletes; a spec may set the order a pass meets the calls in (a directory's own order is the
// filesystem's), or hold a delete.
vi.mock('./recording-tmp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./recording-tmp')>();
  return { ...actual, leftovers: vi.fn(actual.leftovers), removeFiles: vi.fn(actual.removeFiles) };
});

import { prisma } from '@multiwa/database';
import { AppEvents } from '@multiwa/core';
import { InternalEvents } from '../../../metrics/internal-events';
import { MemoryRecordingStore } from '../../../testing/memory-recording-store';
import { CallRecorderService } from './call-recorder.service';
import { recordingKey } from './recording-store';
import { leftovers, readState, removeFiles, writeState, type RecordingState } from './recording-tmp';

const db = prisma as any;
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'recorded.webm'));
const ORG = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const CALL = '33333333-3333-4333-8333-333333333333';
const ANNOUNCEMENT = { storageKey: `announcements/${ORG}/${PROFILE}/44444444-4444-4444-8444-444444444444.wav`, mimeType: 'audio/wav', durationSec: 1.5 };
const ANNOUNCEMENT_BYTES = Buffer.from('RIFF an announcement');
const STARTED = new Date('2026-10-31T09:00:00Z');
const KEY = recordingKey(ORG, PROFILE, CALL, STARTED);
const ROW = {
  id: CALL, profileId: PROFILE, waCallId: 'W1', fromJid: '628111000111@c.us', isVideo: false, isGroup: false, direction: 'incoming',
  outcome: 'answered', rejectedBy: null, startedAt: STARTED, endedAt: null, followUp: 'done', assignedUserId: null,
};

/** The engine's recording and announcement: chunks handed over while it records, the rest of the file at the stop. */
function fakeMedia() {
  let sink: ((chunk: Buffer) => void) | null = null;
  let sent = 0;
  return {
    startRecording: vi.fn(async (_id: string, onChunk: (chunk: Buffer) => void) => {
      sink = onChunk;
    }),
    stopRecording: vi.fn(async (_id: string) => {
      sink?.(FIXTURE.subarray(sent));
      sink = null;
      return { durationMs: 3400 };
    }),
    playAnnouncement: vi.fn(async (_id: string, _audio: Buffer, _opts?: unknown) => ({ durationMs: 1500 })),
    /** Some of the recording, as the page sends it every few seconds. */
    send: (bytes: number) => {
      sink?.(FIXTURE.subarray(sent, sent + bytes));
      sent += bytes;
    },
  };
}

function make() {
  const store = new MemoryRecordingStore();
  store.tmpDir = mkdtempSync(join(tmpdir(), 'recorder-'));
  store.file(ANNOUNCEMENT.storageKey, ANNOUNCEMENT_BYTES);
  const recordings = {
    storageStatus: vi.fn(() => ({ lastCheck: null as null | { ok?: boolean; reason?: string } })),
    checkStorage: vi.fn(async (): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
  };
  const alerts = { recordingFailed: vi.fn(async () => undefined) };
  const events = { emit: vi.fn() };
  const realtime = { emitCallUpdate: vi.fn() };
  const recorder = new CallRecorderService(store, recordings as any, alerts as any, events as any, realtime as any);
  recorder.retryAfterMs = [1, 1, 1];
  const media = fakeMedia();
  let live = true;
  const onAnnouncing = vi.fn();
  const call = { callId: CALL, waCallId: 'W1', profileId: PROFILE, organizationId: ORG, startedAt: STARTED, media: media as any, announcement: ANNOUNCEMENT, live: () => live, onAnnouncing };
  return {
    store, recordings, alerts, events, realtime, recorder, media, call, onAnnouncing,
    /** The call is over, as the coordinator's end makes it (its phase is no longer active). */
    over: () => {
      live = false;
    },
    files: () => readdirSync(store.tmpDir).sort(),
    /** Every storing in flight, done. */
    idle: () => Promise.all([...(recorder as any).keeping.values()]),
    counted: () => events.emit.mock.calls.filter(([e]) => e === InternalEvents.CALL_RECORDER).map(([, p]) => p),
  };
}

const made: Array<ReturnType<typeof make>> = [];
const harness = () => {
  const h = make();
  made.push(h);
  return h;
};

beforeEach(() => {
  db.callRecording.create.mockReset().mockImplementation(async ({ data }: any) => ({ id: 'r1', createdAt: new Date(), deletedAt: null, ...data }));
  db.callRecording.findUnique.mockReset().mockResolvedValue(null);
  db.call.findUnique.mockReset().mockResolvedValue(ROW);
});
afterEach(() => {
  vi.useRealTimers();
  for (const h of made.splice(0)) rmSync(h.store.tmpDir, { recursive: true, force: true });
});

describe('CallRecorderService.plan', () => {
  const settings = (over: Record<string, unknown> = {}) => ({ callsRecording: true, callsAnnouncement: ANNOUNCEMENT, ...over });

  it("records with the profile's own announcement, when recording is on and the storage is set up", () => {
    const { recorder, store } = harness();
    expect(recorder.plan(PROFILE, settings())).toEqual({ announcement: ANNOUNCEMENT });
    expect(recorder.plan(PROFILE, settings({ callsRecording: false }))).toBeNull();
    expect(recorder.plan(PROFILE, settings({ callsAnnouncement: undefined }))).toBeNull();
    // a key read back from the settings is played only when it is this profile's own
    expect(recorder.plan('66666666-6666-4666-8666-666666666666', settings())).toBeNull();
    store.problem = 'CALL_RECORDINGS_PATH is not set';
    expect(recorder.plan(PROFILE, settings())).toBeNull();
    store.problem = null;
    store.tmpProblem = 'CALL_RECORDINGS_TMP is not set';
    expect(recorder.plan(PROFILE, settings())).toBeNull();
  });
});

describe('CallRecorderService.begin', () => {
  it('records first, then plays the announcement, then lets the agent in; the chunks go to its file in order', async () => {
    const h = harness();
    h.media.playAnnouncement.mockImplementation(async () => {
      expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]); // the recording runs while the caller hears it
      return { durationMs: 1500 };
    });
    await h.recorder.begin(h.call);
    expect(h.media.startRecording.mock.calls[0][0]).toBe('W1');
    expect(h.media.startRecording.mock.invocationCallOrder[0]).toBeLessThan(h.media.playAnnouncement.mock.invocationCallOrder[0]);
    expect(h.onAnnouncing).toHaveBeenCalledWith(1.5);
    expect(h.onAnnouncing.mock.invocationCallOrder[0]).toBeLessThan(h.media.playAnnouncement.mock.invocationCallOrder[0]);
    expect(h.media.playAnnouncement).toHaveBeenCalledWith('W1', ANNOUNCEMENT_BYTES, { maxDurationMs: 30_500 });
    expect(await readState(h.store.tmpDir, CALL)).toEqual({ announced: true, stopped: false, announcedAtMs: expect.any(Number) });
    h.media.send(1000);
    h.media.send(2000);
    await h.recorder.end(CALL);
    await h.idle();
    expect(h.store.files.get(KEY)!.body.subarray(-1000).equals(FIXTURE.subarray(-1000))).toBe(true); // in order, whole
  });

  it.each([
    ['the recorder does not start', 'recorder_failed', 'start', (h: ReturnType<typeof make>) => h.media.startRecording.mockRejectedValue(new Error('No caller audio to record'))],
    ['the announcement does not play', 'announcement_failed', 'announcement', (h: ReturnType<typeof make>) => h.media.playAnnouncement.mockRejectedValue(new Error('EncodingError: Unable to decode audio data'))],
    ["the announcement's file is gone", 'announcement_failed', 'announcement', (h: ReturnType<typeof make>) => h.store.files.delete(ANNOUNCEMENT.storageKey)],
    ["the announcement's file is larger than an upload may be", 'announcement_failed', 'announcement', (h: ReturnType<typeof make>) => h.store.file(ANNOUNCEMENT.storageKey, Buffer.alloc(2 * 1024 * 1024 + 1))],
  ] as const)('%s: the agent is let in all the same, the recording goes, the admins are told', async (_case, failure, stage, arrange) => {
    const h = harness();
    arrange(h);
    await h.recorder.begin(h.call);
    // the cleanup goes on after the agent is let in; the alert is its last step
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalledWith(failure, PROFILE));
    // the engine's rule after a failed start, and the end of a recording without its announcement
    expect(h.media.stopRecording).toHaveBeenCalledWith('W1');
    expect(h.files()).toEqual([]);
    expect(h.counted()).toEqual([{ kind: 'failed', stage }]);
    await h.recorder.end(CALL); // the call's end, later: nothing is left to keep
    await h.idle();
    expect(db.callRecording.create).not.toHaveBeenCalled();
    if (stage === 'start') expect(h.media.playAnnouncement).not.toHaveBeenCalled();
  });

  it.each([
    ['its tmpDir does not exist', (h: ReturnType<typeof make>) => rmSync(h.store.tmpDir, { recursive: true })],
    // a full disk or a refused permission on the state alone (the recording file opens): a directory in its place
    ['its state cannot be written', (h: ReturnType<typeof make>) => mkdirSync(join(h.store.tmpDir, `${CALL}.json`))],
  ] as const)('%s: the recorder does not start, the agent is let in all the same, the admins are told', async (_case, arrange) => {
    const h = harness();
    arrange(h);
    await h.recorder.begin(h.call);
    expect(h.media.startRecording).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalledWith('recorder_failed', PROFILE));
    expect(h.counted()).toEqual([{ kind: 'failed', stage: 'start' }]);
  });

  it('a start that does not answer in 8 s is a recorder that did not start', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.media.startRecording.mockReturnValue(new Promise(() => undefined));
    const begun = h.recorder.begin(h.call);
    await vi.waitFor(() => expect(h.media.startRecording).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(8_000);
    await begun;
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalledWith('recorder_failed', PROFILE));
  });

  it('an announcement not read in 5 s (a body that stalls after a quick answer) did not play, and its stream is let go of', async () => {
    vi.useFakeTimers();
    const h = harness();
    const stalled = new PassThrough(); // never ends
    let reading!: () => void;
    const read = new Promise<void>((resolve) => (reading = resolve));
    vi.spyOn(h.store, 'read').mockImplementation(async () => {
      reading();
      return stalled;
    });
    let begun = false;
    void h.recorder.begin(h.call).then(() => (begun = true));
    await read;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(begun).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(begun).toBe(true);
    expect(stalled.destroyed).toBe(true);
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalledWith('announcement_failed', PROFILE));
    expect(h.media.playAnnouncement).not.toHaveBeenCalled();
  });

  it('an announcement that does not end is waited for as long as its own length allows: 10 s for 1.5 s, not 38.5 s', async () => {
    vi.useFakeTimers();
    const h = harness();
    let playing!: () => void;
    const played = new Promise<void>((resolve) => (playing = resolve));
    h.media.playAnnouncement.mockImplementation(() => {
      playing();
      return new Promise(() => undefined); // a hung page
    });
    let begun = false;
    void h.recorder.begin(h.call).then(() => (begun = true));
    await played;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(begun).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(begun).toBe(true);
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalledWith('announcement_failed', PROFILE));
  });

  it('a stream that opens after the read gave up is let go of as it opens', async () => {
    vi.useFakeTimers();
    const h = harness();
    const late = new PassThrough();
    let open!: (body: PassThrough) => void;
    let reading!: () => void;
    const read = new Promise<void>((resolve) => (reading = resolve));
    vi.spyOn(h.store, 'read').mockImplementation(() => {
      reading();
      return new Promise((resolve) => (open = resolve));
    });
    const begun = h.recorder.begin(h.call);
    await read;
    await vi.advanceTimersByTimeAsync(5_000);
    await begun;
    open(late);
    await vi.waitFor(() => expect(late.destroyed).toBe(true));
  });

  it('a failed recording does not keep the agent waiting for its cleanup; an end meanwhile keeps nothing', async () => {
    const h = harness();
    h.media.startRecording.mockRejectedValue(new Error('No caller audio to record'));
    let release!: () => void;
    h.media.stopRecording.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ durationMs: 0 }))));
    await h.recorder.begin(h.call); // resolves while the engine's stop is still held
    expect(h.media.stopRecording).toHaveBeenCalledWith('W1');
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['discarded']);
    release();
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalled()); // the cleanup's last step
    expect(h.alerts.recordingFailed).toHaveBeenCalledTimes(1);
    expect(h.alerts.recordingFailed).toHaveBeenCalledWith('recorder_failed', PROFILE);
    expect(h.files()).toEqual([]);
    expect(h.media.stopRecording).toHaveBeenCalledTimes(1);
    expect(db.callRecording.create).not.toHaveBeenCalled();
  });

  it('a call that ends during the announcement fails nothing: no recording is kept, nobody is alerted', async () => {
    const h = harness();
    h.media.playAnnouncement.mockImplementation(async () => {
      h.over();
      throw new Error('The call ended');
    });
    await h.recorder.begin(h.call);
    await h.recorder.end(CALL);
    await h.idle();
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled();
    expect(h.counted()).toEqual([]);
    expect(h.files()).toEqual([]);
    expect(db.callRecording.create).not.toHaveBeenCalled();
  });

  it('a call that ends while its announcement plays keeps nothing, though the announcement then finishes', async () => {
    const h = harness();
    h.media.playAnnouncement.mockImplementation(async () => {
      // WhatsApp's call is still up (a hang-up that timed out, a server_restart end): the page plays on
      h.over();
      await h.recorder.end(CALL);
      return { durationMs: 1500 };
    });
    await h.recorder.begin(h.call);
    await h.idle();
    expect(db.callRecording.create).not.toHaveBeenCalled();
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled();
    expect(h.counted()).toEqual([]);
    expect(h.files()).toEqual([]);
  });

  it('a call that ended before its recorder started is not recorded', async () => {
    const h = harness();
    h.over();
    await h.recorder.begin(h.call);
    expect(h.media.startRecording).not.toHaveBeenCalled();
    expect(h.files()).toEqual([]);
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled();
  });
});

describe('CallRecorderService.end', () => {
  it('stops the recorder, then in the background: its length written in, stored under its key, its row, its files gone, call.recording.ready', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    h.media.send(5000);
    let release!: () => void;
    const put = vi.spyOn(h.store, 'putFile').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return MemoryRecordingStore.prototype.putFile.apply(h.store, args);
    });
    await h.recorder.end(CALL); // returns without waiting for the storage
    expect(h.media.stopRecording).toHaveBeenCalledWith('W1');
    await vi.waitFor(() => expect(put).toHaveBeenCalled());
    expect(db.callRecording.create).not.toHaveBeenCalled();
    release();
    await h.idle();
    expect(put.mock.calls[0]).toEqual([KEY, join(h.store.tmpDir, `${CALL}.final.webm`), 'audio/webm']);
    expect(h.store.files.get(KEY)!.body.length).toBe(FIXTURE.length + 11); // the Duration written in
    expect(db.callRecording.create).toHaveBeenCalledWith({
      data: {
        callId: CALL, profileId: PROFILE, storageType: 'local', storageLocation: 'memory:test', storageKey: KEY, mimeType: 'audio/webm',
        bytes: FIXTURE.length + 11, durationSec: 3, channels: 2, announcementPlayed: true, partial: false,
      },
    });
    expect(h.files()).toEqual([]);
    expect(h.events.emit).toHaveBeenCalledWith(AppEvents.CALL.RECORDING_READY, {
      profileId: PROFILE, callId: CALL, recordingId: 'r1', durationSec: 3, bytes: FIXTURE.length + 11, partial: false,
    });
    await vi.waitFor(() => expect(h.realtime.emitCallUpdate).toHaveBeenCalledWith(PROFILE, expect.objectContaining({ callId: CALL, profileId: PROFILE, hasRecording: true })));
    expect(h.counted()).toEqual([{ kind: 'upload', result: 'ok' }]);
  });

  it('a stop that fails keeps what was recorded, as partial', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    h.media.send(FIXTURE.length);
    h.media.stopRecording.mockRejectedValue(new Error('1 of 3 recording chunks were not delivered'));
    await h.recorder.end(CALL);
    await h.idle();
    expect(db.callRecording.create.mock.calls[0][0].data.partial).toBe(true);
  });

  it('a file that could not be written on is saved as partial, for the boot or the nightly job to store as such', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    (h.recorder as any).runs.get(CALL).out.emit('error', Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }));
    vi.spyOn(h.store, 'putFile').mockRejectedValue(new Error('connect ETIMEDOUT'));
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['kept']);
    expect(await readState(h.store.tmpDir, CALL)).toMatchObject({ announced: true, stopped: false });
  });

  // The page sends its chunks every 5 s: a stop that fails may lose the one with the announcement's last seconds.
  it.each([
    ['lasted 4 s: its file (3.4 s) ends before it did, so nothing is kept', 0, 4_000, 'discarded', 0],
    ['lasted 1.5 s after a 3-s start: counted from the start, its file (3.4 s) holds it whole', 3_000, 1_500, 'stored', 1],
  ] as const)('a stop that fails, and an announcement that %s', async (_case, startMs, playMs, result, rows) => {
    vi.useFakeTimers({ toFake: ['Date'] }); // the clock alone, moved by hand
    const h = harness();
    const start = h.media.startRecording.getMockImplementation()!;
    h.media.startRecording.mockImplementation(async (...args) => {
      vi.advanceTimersByTime(startMs); // the page waits for the caller's audio: before the recording's own time
      return start(...args);
    });
    h.media.playAnnouncement.mockImplementation(async () => {
      vi.advanceTimersByTime(playMs);
      return { durationMs: playMs };
    });
    await h.recorder.begin(h.call);
    h.media.send(FIXTURE.length); // all the page sent before its stop failed
    h.media.stopRecording.mockRejectedValue(new Error('1 of 3 recording chunks were not delivered'));
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual([result]);
    expect(db.callRecording.create).toHaveBeenCalledTimes(rows);
    expect(h.files()).toEqual([]);
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled(); // the caller hung up, or the server stopped, then
  });

  it('a file whose write fails only as it closes (EIO, EFBIG) is saved as partial too', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    const out = (h.recorder as any).runs.get(CALL).out;
    out.once('finish', () => out.emit('error', Object.assign(new Error('EIO: i/o error, close'), { code: 'EIO' })));
    vi.spyOn(h.store, 'putFile').mockRejectedValue(new Error('connect ETIMEDOUT'));
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['kept']);
    expect(await readState(h.store.tmpDir, CALL)).toMatchObject({ announced: true, stopped: false });
  });

  it('the upload is tried four times: stored on the fourth', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    const put = vi.spyOn(h.store, 'putFile');
    for (let i = 0; i < 3; i++) put.mockRejectedValueOnce(new Error('503 Slow Down'));
    await h.recorder.end(CALL);
    await h.idle();
    expect(put).toHaveBeenCalledTimes(4);
    expect(db.callRecording.create).toHaveBeenCalledTimes(1);
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled();
  });

  it('four failed tries: the files stay for the next try, the admins are told', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    vi.spyOn(h.store, 'putFile').mockRejectedValue(new Error('connect ETIMEDOUT'));
    await h.recorder.end(CALL);
    await h.idle();
    expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]); // the final copy goes; the recording and its state stay
    expect(await readState(h.store.tmpDir, CALL)).toMatchObject({ announced: true, stopped: true });
    expect(h.alerts.recordingFailed).toHaveBeenCalledWith('upload_failed', PROFILE);
    expect(h.counted()).toEqual([{ kind: 'upload', result: 'failed' }]);
    expect(db.callRecording.create).not.toHaveBeenCalled();
  });

  it('never stored to a storage last found readable without a login: kept for when it is private again', async () => {
    const h = harness();
    h.recordings.storageStatus.mockReturnValue({ lastCheck: { reason: 'storage_not_private' } });
    await h.recorder.begin(h.call);
    const put = vi.spyOn(h.store, 'putFile');
    await h.recorder.end(CALL);
    await h.idle();
    expect(put).not.toHaveBeenCalled();
    expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]);
  });

  it('a storage found readable without a login during the tries gets no further try; the files stay, and its own alert covers it', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    const put = vi.spyOn(h.store, 'putFile').mockImplementationOnce(async () => {
      // a privacy check finishes meanwhile (recording turned on for some profile, or the nightly job)
      h.recordings.storageStatus.mockReturnValue({ lastCheck: { reason: 'storage_not_private' } });
      throw new Error('503 Slow Down');
    });
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['kept']);
    expect(put).toHaveBeenCalledTimes(1);
    expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]);
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled();
    expect(h.counted()).toEqual([]);
  });

  it('stored, but its files could not be deleted: call.recording.ready goes out all the same', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    mkdirSync(join(h.store.tmpDir, `${CALL}.json.1a2b3c4d.part`)); // a directory: its rm rejects
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['stored']);
    expect(h.events.emit).toHaveBeenCalledWith(AppEvents.CALL.RECORDING_READY, expect.objectContaining({ callId: CALL, recordingId: 'r1' }));
    expect(h.counted()).toEqual([{ kind: 'upload', result: 'ok' }]);
  });

  it('its call gone when its row is written (its profile deleted meanwhile): the stored file and the files go', async () => {
    const h = harness();
    db.callRecording.create.mockRejectedValue(Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }));
    await h.recorder.begin(h.call);
    await h.recorder.end(CALL);
    await h.idle();
    expect(h.store.files.has(KEY)).toBe(false);
    expect(h.files()).toEqual([]);
    expect(h.events.emit).not.toHaveBeenCalledWith(AppEvents.CALL.RECORDING_READY, expect.anything());
  });

  it('its row not written (the database down): counted as not stored, the files stay, nobody alerted', async () => {
    const h = harness();
    db.callRecording.create.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    await h.recorder.begin(h.call);
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual(['kept']);
    expect(h.counted()).toEqual([{ kind: 'upload', result: 'failed' }]);
    expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]);
    expect(h.alerts.recordingFailed).not.toHaveBeenCalled(); // a database that is down cannot store the bell either
  });

  it('stored already (an earlier try whose files were not deleted): the files go, no second event', async () => {
    const h = harness();
    db.callRecording.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    await h.recorder.begin(h.call);
    await h.recorder.end(CALL);
    await h.idle();
    expect(h.files()).toEqual([]);
    expect(h.events.emit).not.toHaveBeenCalledWith(AppEvents.CALL.RECORDING_READY, expect.anything());
  });

  it.each([
    ['stored already (P2002)', 'stored', 'P2002'],
    ['its call gone (P2003)', 'discarded', 'P2003'],
  ] as const)('%s, though its files could not be deleted: %s all the same, and no upload counted as failed', async (_case, result, code) => {
    const h = harness();
    db.callRecording.create.mockRejectedValue(Object.assign(new Error('Constraint failed'), { code }));
    await h.recorder.begin(h.call);
    mkdirSync(join(h.store.tmpDir, `${CALL}.json.1a2b3c4d.part`)); // a directory: its rm rejects
    await h.recorder.end(CALL);
    expect(await h.idle()).toEqual([result]);
    expect(h.counted()).toEqual([]);
  });

  it('the end of a call it does not record does nothing', async () => {
    const h = harness();
    await h.recorder.end(CALL);
    expect(h.media.stopRecording).not.toHaveBeenCalled();
  });
});

describe('CallRecorderService.finishLeftovers', () => {
  const OTHER = '55555555-5555-4555-8555-555555555555';
  const NOW = new Date('2026-11-01T02:30:00Z');
  const row = (settings: Record<string, unknown> = {}) => ({ ...ROW, profile: { settings, workspace: { organizationId: ORG } } });
  /** Files a crash left for `callId`: the fixture recording and a state, last written `daysAgo` before NOW. */
  const leftover = async (h: ReturnType<typeof make>, callId: string, state: RecordingState | null, daysAgo = 0) => {
    if (state) await writeState(h.store.tmpDir, callId, state);
    const recording = join(h.store.tmpDir, `${callId}.webm`);
    writeFileSync(recording, FIXTURE);
    const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
    utimesSync(recording, at, at);
    if (state) utimesSync(join(h.store.tmpDir, `${callId}.json`), at, at);
  };

  it('stores one a restart cut short (announced, not stopped) as partial, in one try', async () => {
    const h = harness();
    await leftover(h, CALL, { announced: true, stopped: false });
    db.call.findUnique.mockResolvedValue(row());
    const put = vi.spyOn(h.store, 'putFile');
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 1, kept: 0, discarded: 0 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(db.callRecording.create.mock.calls[0][0].data).toMatchObject({ callId: CALL, storageKey: KEY, partial: true, announcementPlayed: true });
    expect(h.files()).toEqual([]);
  });

  it('a stopped one that could not be stored before is stored now, and not as partial', async () => {
    const h = harness();
    await leftover(h, CALL, { announced: true, stopped: true });
    db.call.findUnique.mockResolvedValue(row());
    await h.recorder.finishLeftovers(NOW);
    expect(db.callRecording.create.mock.calls[0][0].data.partial).toBe(false);
  });

  it.each([
    ['its announcement had not played', { announced: false, stopped: false }, (): unknown => row(), 0],
    ['it has no state', null, (): unknown => row(), 0],
    ['its call is gone', { announced: true, stopped: true }, (): unknown => null, 0],
    ["it is older than its profile's retention period", { announced: true, stopped: true }, (): unknown => row({ callsRecordingRetentionDays: 7 }), 8],
    ['its file (3.4 s) ends before its announcement did', { announced: true, stopped: false, announcedAtMs: 4_000 }, (): unknown => row(), 0],
  ] as const)('discards one when %s', async (_case, state, found, daysAgo) => {
    const h = harness();
    await leftover(h, CALL, state, daysAgo);
    db.call.findUnique.mockResolvedValue(found());
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 0, kept: 0, discarded: 1 });
    expect(h.files()).toEqual([]);
    expect(db.callRecording.create).not.toHaveBeenCalled();
  });

  // Another upload would put back audio an admin deleted since, or leave a copy no row points to once the storage moved.
  it('one stored already (by a try whose files were not deleted): its files go, with no second upload and no event', async () => {
    const h = harness();
    await leftover(h, CALL, { announced: true, stopped: true });
    db.call.findUnique.mockResolvedValue(row());
    db.callRecording.findUnique.mockResolvedValue({ id: 'r1' });
    db.callRecording.create.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
    const put = vi.spyOn(h.store, 'putFile');
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 1, kept: 0, discarded: 0 });
    expect(put).not.toHaveBeenCalled();
    expect(h.files()).toEqual([]);
    expect(h.events.emit).not.toHaveBeenCalled(); // no call.recording.ready, no counter
  });

  it('keeps one whose upload fails again, and tells the admins; the next night tries again', async () => {
    const h = harness();
    await leftover(h, CALL, { announced: true, stopped: true });
    db.call.findUnique.mockResolvedValue(row());
    vi.spyOn(h.store, 'putFile').mockRejectedValueOnce(new Error('503'));
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 0, kept: 1, discarded: 0 });
    expect(h.alerts.recordingFailed).toHaveBeenCalledWith('upload_failed', PROFILE);
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 1, kept: 0, discarded: 0 });
  });

  it('leaves alone the files of a call it is recording', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    await leftover(h, OTHER, { announced: false, stopped: false });
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 0, kept: 0, discarded: 1 });
    expect(h.files()).toEqual([`${CALL}.json`, `${CALL}.webm`]);
  });

  it('leaves alone a call it was storing when the pass listed it, though that storing is over by its turn', async () => {
    const h = harness();
    await h.recorder.begin(h.call);
    let upload!: () => void;
    const put = vi.spyOn(h.store, 'putFile').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (upload = resolve));
      return MemoryRecordingStore.prototype.putFile.apply(h.store, args);
    });
    await h.recorder.end(CALL);
    const storing = (h.recorder as any).keeping.get(CALL);
    await vi.waitFor(() => expect(put).toHaveBeenCalled());
    await leftover(h, OTHER, { announced: true, stopped: true });
    let other!: () => void;
    const held = new Promise<void>((resolve) => (other = resolve));
    db.call.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === OTHER) await held;
      return row();
    });
    // OTHER first: CALL's storing finishes while the pass holds on OTHER, before CALL's turn
    const actual = await vi.importActual<typeof import('./recording-tmp')>('./recording-tmp');
    vi.mocked(leftovers).mockImplementationOnce(async (dir) => (await actual.leftovers(dir)).sort((a, b) => Number(a.callId === CALL) - Number(b.callId === CALL)));
    const pass = h.recorder.finishLeftovers(NOW);
    await vi.waitFor(() => expect(db.call.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OTHER } })));
    upload();
    expect(await storing).toBe('stored');
    other();
    expect(await pass).toEqual({ stored: 1, kept: 0, discarded: 0 }); // OTHER's alone
  });

  it('leaves alone a failed recording its drop is deleting in the background, though the drop ends while it lists', async () => {
    const h = harness();
    h.media.startRecording.mockRejectedValue(new Error('No caller audio to record'));
    const actual = await vi.importActual<typeof import('./recording-tmp')>('./recording-tmp');
    let deleting!: () => void;
    const deleteHeld = new Promise<void>((resolve) => (deleting = resolve));
    let deleteNow!: () => void;
    const deleted = new Promise<void>((resolve) => (deleteNow = resolve));
    vi.mocked(removeFiles).mockImplementationOnce(async (dir, callId) => {
      deleting();
      await deleted;
      return actual.removeFiles(dir, callId);
    });
    await h.recorder.begin(h.call); // its drop goes on in the background
    await deleteHeld;
    let listing!: () => void;
    const listHeld = new Promise<void>((resolve) => (listing = resolve));
    let listNow!: () => void;
    const listed = new Promise<void>((resolve) => (listNow = resolve));
    vi.mocked(leftovers).mockImplementationOnce(async (dir) => {
      const found = await actual.leftovers(dir);
      listing();
      await listed;
      return found;
    });
    const pass = h.recorder.finishLeftovers(NOW);
    await listHeld; // the pass saw the drop's files
    deleteNow();
    await vi.waitFor(() => expect(h.alerts.recordingFailed).toHaveBeenCalled()); // the drop's last step
    listNow();
    expect(await pass).toEqual({ stored: 0, kept: 0, discarded: 0 });
  });

  it('does nothing without a storage set up', async () => {
    const h = harness();
    h.store.problem = 'CALL_RECORDINGS_PATH is not set';
    expect(await h.recorder.finishLeftovers(NOW)).toEqual({ stored: 0, kept: 0, discarded: 0 });
  });

  // The last privacy check lives in memory: after a restart there is none, though the storage may still be public.
  it.each([
    ['private: what was left is stored', { ok: true }, { stored: 1, kept: 0, discarded: 0 }, 1],
    ['readable without a login: nothing is stored', { ok: false, reason: 'storage_not_private' }, { stored: 0, kept: 1, discarded: 0 }, 0],
  ] as const)('at boot, with something left, checks the storage first, without holding the boot up; found %s', async (_case, check, counts, puts) => {
    const h = harness();
    await leftover(h, CALL, { announced: true, stopped: true });
    db.call.findUnique.mockResolvedValue(row());
    h.recordings.checkStorage.mockImplementation(async () => {
      h.recordings.storageStatus.mockReturnValue({ lastCheck: check }); // the status then reports it, as the service's does
      return check;
    });
    const put = vi.spyOn(h.store, 'putFile');
    const pass = vi.spyOn(h.recorder, 'finishLeftovers');
    expect(h.recorder.onApplicationBootstrap()).toBeUndefined();
    await vi.waitFor(() => expect(pass).toHaveBeenCalled());
    expect(await pass.mock.results[0].value).toEqual(counts);
    expect(put).toHaveBeenCalledTimes(puts);
    expect(h.recordings.checkStorage.mock.invocationCallOrder[0]).toBeLessThan(pass.mock.invocationCallOrder[0]);
  });

  it('a boot with nothing left makes no privacy probe', async () => {
    const h = harness();
    const pass = vi.spyOn(h.recorder, 'finishLeftovers');
    h.recorder.onApplicationBootstrap();
    await vi.waitFor(() => expect(pass).toHaveBeenCalled());
    await pass.mock.results[0].value;
    expect(h.recordings.checkStorage).not.toHaveBeenCalled();
  });
});

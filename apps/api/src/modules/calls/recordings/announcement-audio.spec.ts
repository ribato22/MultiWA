// What an uploaded announcement really is, read from its own bytes: one of the formats Chromium (WhatsApp Web's page)
// plays, with a length at most 30 seconds as a player counts it. Never what the client says (a file name or
// Content-Type), nor only what a header says: the fixtures are ffmpeg-made, and one is a text file named .mp3.
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Logger, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inspectAnnouncement } from './announcement-audio';

// The reader thread is real, unless a test stands one in to make its events come in a given order.
vi.mock('worker_threads', async (importOriginal) => {
  const real = await importOriginal<typeof import('worker_threads')>();
  return { ...real, Worker: vi.fn(function (...args: ConstructorParameters<typeof real.Worker>) { return new real.Worker(...args); }) };
});

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

// The ASF Header Object with one object, whose size (at byte 46) stays 0.
const ASF = Buffer.alloc(64);
Buffer.from('3026B2758E66CF11A6D900AA0062CE6C', 'hex').copy(ASF, 0);
ASF.writeUInt32LE(1, 24);
Buffer.from('8CABDCA1A94711CF8EE400C00C205365', 'hex').copy(ASF, 30);

// An AIFF-C of one second whose compression name, copied from the file into the codec, says MPEG-4/AAC.
const AIFC = Buffer.concat([
  Buffer.from('FORM\0\0\0\x3eAIFC', 'latin1'),
  Buffer.from('COMM\0\0\0\x22', 'latin1'),
  Buffer.from('000100001f400010400bfa00000000000000', 'hex'), // mono, 8000 frames of 16 bits, 8000 Hz
  Buffer.from('NONE\x0aMPEG-4/AAC\0', 'latin1'),
  Buffer.from('SSND\0\0\0\x08\0\0\0\0\0\0\0\0', 'latin1'),
]);

// 60 s of silence as a PCM WAV: 8000 Hz, mono, 16 bits, so a block (bytes 32-33) of 2 bytes.
const SIXTY_SECONDS_WAV = Buffer.concat([
  Buffer.from('RIFF\x24\xa6\x0e\0WAVEfmt \x10\0\0\0', 'latin1'),
  Buffer.from('01000100401f0000803e000002001000', 'hex'), // PCM, mono, 8000 Hz, 16000 bytes a second, block 2, 16 bits
  Buffer.from('data\0\xa6\x0e\0', 'latin1'),
  Buffer.alloc(960000),
]);

const longerThan30 = (seconds: number) => `The announcement must be at most 30 seconds; this one is ${seconds} seconds`;

describe('inspectAnnouncement', () => {
  it.each([
    ['tone.mp3', 'audio/mpeg', 'mp3'],
    ['tone.wav', 'audio/wav', 'wav'],
    ['alaw.wav', 'audio/wav', 'wav'],
    ['mulaw.wav', 'audio/wav', 'wav'], // µ-law
    ['float.wav', 'audio/wav', 'wav'], // 32-bit IEEE float
    ['tone.ogg', 'audio/ogg', 'ogg'],
    ['tone.webm', 'audio/webm', 'webm'],
    ['tone.m4a', 'audio/mp4', 'm4a'],
    ['isom.mp4', 'audio/mp4', 'm4a'], // AAC in an MP4 whose major brand is isom (ffmpeg's -f mp4), not M4A
  ])('%s: %s, its length read from the file', async (name, mimeType, ext) => {
    const audio = await inspectAnnouncement(fixture(name));
    expect(audio).toMatchObject({ mimeType, ext });
    // One second of tone; encoders pad a little (an mp3 or AAC frame here is 0.07-0.15 s).
    expect(audio.durationSec).toBeGreaterThanOrEqual(0.9);
    expect(audio.durationSec).toBeLessThanOrEqual(1.3);
  });

  it.each([
    ['a text file named .mp3', fixture('not-audio.mp3')],
    ['a 24-bit WAV in WAVE_FORMAT_EXTENSIBLE, whose codec is a GUID music-metadata does not read', fixture('pcm24.wav')],
    ['a 64-bit float WAV, which Chromium does not decode', fixture('float64.wav')],
    ['an AIFF-C whose compression name says MPEG-4/AAC', AIFC],
    ['64 bytes of ASF whose one object says it is 0 bytes long, read to the end (file-type 16.5.4 looped on it forever)', ASF],
    ['nothing at all', Buffer.alloc(0)],
  ])('415 for %s', async (_, file) => {
    const refused = await inspectAnnouncement(file).catch((e) => e);
    expect(refused).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(refused.message).toBe('The announcement must be an mp3, wav (PCM, 32-bit float, A-law or µ-law), ogg, webm or m4a audio file');
  });

  it('422 for a file that does not say how long it is (WebM as a browser records it)', async () => {
    const refused = await inspectAnnouncement(fixture('no-duration.webm')).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toContain('does not say how long it is');
  });

  it('422 for a negative length (an Ogg Opus whose pre-skip passes its last granule position)', async () => {
    const ogg = fixture('tone.ogg');
    ogg.writeBigUInt64LE(0n, ogg.lastIndexOf('OggS') + 6); // the last page's granule, under the 312 samples of pre-skip
    const refused = await inspectAnnouncement(ogg).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toContain('does not say how long it is');
  });

  it('422 for longer than 30 seconds, saying how long it is', async () => {
    const refused = await inspectAnnouncement(fixture('long.mp3')).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe(longerThan30(31));
  });

  it('30 s as an encoder writes it is not longer than 30 s; four frames more is', async () => {
    // 30 s of tone at 8 kbps: 30.17 s by its Info header, 30.24 s by its 420 frames (the Info frame is one of them).
    expect((await inspectAnnouncement(fixture('thirty.mp3'))).durationSec).toBe(30.2);
    // The last four frames of another file (72 bytes each at 8 kbps and 8 kHz) behind it: 30.53 s.
    const long = fixture('long.mp3');
    const refused = await inspectAnnouncement(Buffer.concat([fixture('thirty.mp3'), long.subarray(long.length - 4 * 72)])).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
  });

  it("422 for two mp3 files back to back: the first one's header says 30.2 s, their frames 61 s", async () => {
    const refused = await inspectAnnouncement(Buffer.concat([fixture('thirty.mp3'), fixture('long.mp3')])).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe(longerThan30(61));
  });

  it("422 for a VBR mp3 with a CBR one behind it: the first one's Xing header says 2.2 s, their frames 33 s", async () => {
    const refused = await inspectAnnouncement(Buffer.concat([fixture('vbr.mp3'), fixture('long.mp3')])).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe(longerThan30(33));
  });

  it('an ID3v1 tag at the end is no audio: 30 s with one is still 30.2 s', async () => {
    const id3v1 = Buffer.concat([Buffer.from('TAGWelcome', 'latin1'), Buffer.alloc(118)]);
    expect((await inspectAnnouncement(Buffer.concat([fixture('thirty.mp3'), id3v1]))).durationSec).toBe(30.2);
  });

  it('an ID3 tag (where a cover goes) is not counted as audio: the tone behind 64 KB of tag still reads 1.2 s', async () => {
    // ID3v2.4 with 65536 bytes of padding (its size, 7 bits a byte: 0 4 0 0), in place of the tone's own 44-byte tag.
    const tag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 4, 0, 0]), Buffer.alloc(65536)]);
    expect((await inspectAnnouncement(Buffer.concat([tag, fixture('tone.mp3').subarray(44)]))).durationSec).toBe(1.2);
  });

  it("an ID3v2 tag's size is 7 bits a byte: 0 0 127 127 is 16383 bytes, not 32639", async () => {
    // In front of the two files back to back (61 s): read as a plain number, the size would skip 16 s of their frames.
    const tag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x7f, 0x7f]), Buffer.alloc(16383)]);
    const refused = await inspectAnnouncement(Buffer.concat([tag, fixture('thirty.mp3'), fixture('long.mp3')])).catch((e) => e);
    expect(refused.message).toBe(longerThan30(61));
  });

  it("a WAV's length from its bytes too: a fact chunk saying 0.01 s of a 1-s file reads 1 s", async () => {
    const wav = fixture('alaw.wav');
    wav.writeUInt32LE(80, wav.indexOf('fact') + 8); // 80 samples at 8000 Hz
    expect((await inspectAnnouncement(wav)).durationSec).toBe(1);
  });

  it("a WAV's length from its sample format, as decoders read it: a block size edited from 2 to 8 does not make 60 s 15 s", async () => {
    const wav = Buffer.from(SIXTY_SECONDS_WAV);
    wav.writeUInt16LE(8, 32);
    const refused = await inspectAnnouncement(wav).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe(longerThan30(60));
  });

  it('reads in a worker thread: a file that keeps the parser busy past the time limit is refused, and timers still fire', async () => {
    let ticked = false;
    setTimeout(() => (ticked = true), 20);
    // 2 MB of 0xFF: the MPEG parser resyncs on every byte, ~1.8 s of CPU.
    const refused = await inspectAnnouncement(Buffer.alloc(2 * 1024 * 1024, 0xff), { timeoutMs: 50 }).catch((e) => e);
    expect(ticked).toBe(true);
    expect(refused).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(refused.message).toContain('could not be read');
  });

  it('reads at most two at once: a third is turned away with 503 at once, and the next one after them is read', async () => {
    // 2 MB of 0xFF keeps each of the two readers busy ~1.8 s, within the default time limit.
    const busy = Buffer.alloc(2 * 1024 * 1024, 0xff);
    const two = [inspectAnnouncement(busy), inspectAnnouncement(busy)].map((read) => read.catch((e) => e));
    const third = await inspectAnnouncement(busy).catch((e) => e);
    expect(third).toBeInstanceOf(ServiceUnavailableException);
    expect(third.message).toBe('Another announcement is being read; try again in a moment');
    for (const refused of await Promise.all(two)) expect(refused).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(await inspectAnnouncement(fixture('tone.mp3'))).toMatchObject({ ext: 'mp3' });
  }, 20_000);
});

describe("inspectAnnouncement's reader thread", () => {
  // A reader that answers or exits only when told to; its terminate() does not make it exit.
  const standIn = () => {
    const reader = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => 0) });
    vi.mocked(Worker).mockImplementationOnce(function () {
      return reader as unknown as Worker;
    });
    return reader;
  };
  let warn: MockInstance;
  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it('an answer just before the time limit is no timeout, though the thread exits after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reader = standIn();
    const read = inspectAnnouncement(fixture('tone.mp3'), { timeoutMs: 1000 }).catch((e) => e);
    vi.advanceTimersByTime(999);
    reader.emit('message', null); // music-metadata did not know the format
    expect((await read).message).toContain('must be an mp3');
    vi.advanceTimersByTime(1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a thread that exits without an answer is logged with its exit code, and the file is unreadable', async () => {
    const reader = standIn();
    const read = inspectAnnouncement(fixture('tone.mp3')).catch((e) => e);
    reader.emit('exit', 0);
    expect((await read).message).toContain('could not be read');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exited with code 0'));
  });
});

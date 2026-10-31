// What an uploaded announcement really is, read from its own bytes: one of the formats Chromium (WhatsApp Web's page)
// plays, with a length at most 30 seconds. Never what the client says (a file name or Content-Type): the fixtures are
// ffmpeg-made, and one is a text file named .mp3.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inspectAnnouncement } from './announcement-audio';

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

describe('inspectAnnouncement', () => {
  it.each([
    ['tone.mp3', 'audio/mpeg', 'mp3'],
    ['tone.wav', 'audio/wav', 'wav'],
    ['alaw.wav', 'audio/wav', 'wav'],
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
    ['an AIFF-C whose compression name says MPEG-4/AAC', AIFC],
    ['64 bytes of ASF whose one object says it is 0 bytes long, read to the end (file-type 16.5.4 looped on it forever)', ASF],
    ['nothing at all', Buffer.alloc(0)],
  ])('415 for %s', async (_, file) => {
    const refused = await inspectAnnouncement(file).catch((e) => e);
    expect(refused).toBeInstanceOf(UnsupportedMediaTypeException);
    expect(refused.message).toBe('The announcement must be an mp3, wav (PCM, float or A-law), ogg, webm or m4a audio file');
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
    expect(refused.message).toBe('The announcement must be at most 30 seconds; this one is 31 seconds');
  });

  it('30 s as an encoder writes it is not longer than 30 s; 0.15 s more is', async () => {
    // 30 s of tone at 8 kbps: 30.17 s by its Info header, 30.38 s by its bytes (the header frame counts as audio).
    expect((await inspectAnnouncement(fixture('thirty.mp3'))).durationSec).toBe(30.4);
    const refused = await inspectAnnouncement(Buffer.concat([fixture('thirty.mp3'), Buffer.alloc(150)])).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
  });

  it("422 for two mp3 files back to back: the first one's header says 30.2 s, the bytes 62 s", async () => {
    const refused = await inspectAnnouncement(Buffer.concat([fixture('thirty.mp3'), fixture('long.mp3')])).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe('The announcement must be at most 30 seconds; this one is 62 seconds');
  });

  it('an ID3 tag (where a cover goes) is not counted as audio: the tone behind 64 KB of tag still reads 1.2 s', async () => {
    // ID3v2.4 with 65536 bytes of padding (its size, 7 bits a byte: 0 4 0 0), in place of the tone's own 44-byte tag.
    const tag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 4, 0, 0]), Buffer.alloc(65536)]);
    expect((await inspectAnnouncement(Buffer.concat([tag, fixture('tone.mp3').subarray(44)]))).durationSec).toBe(1.2);
  });

  it("a WAV's length from its bytes too: a fact chunk saying 0.01 s of a 1-s file reads 1 s", async () => {
    const wav = fixture('alaw.wav');
    wav.writeUInt32LE(80, wav.indexOf('fact') + 8); // 80 samples at 8000 Hz
    expect((await inspectAnnouncement(wav)).durationSec).toBe(1);
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
});

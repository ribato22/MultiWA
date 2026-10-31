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

  it('422 for longer than 30 seconds, saying how long it is', async () => {
    const refused = await inspectAnnouncement(fixture('long.mp3')).catch((e) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityException);
    expect(refused.message).toBe('The announcement must be at most 30 seconds; this one is 31 seconds');
  });
});

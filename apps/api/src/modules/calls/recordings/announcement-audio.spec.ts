// What an uploaded announcement really is, read from its own bytes: one of the formats Chromium (WhatsApp Web's page)
// plays, with a length at most 30 seconds. Never what the client says (a file name or Content-Type): the fixtures are
// ffmpeg-made, and one is a text file named .mp3.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inspectAnnouncement } from './announcement-audio';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));

describe('inspectAnnouncement', () => {
  it.each([
    ['tone.mp3', 'audio/mpeg', 'mp3'],
    ['tone.wav', 'audio/wav', 'wav'],
    ['tone.ogg', 'audio/ogg', 'ogg'],
    ['tone.webm', 'audio/webm', 'webm'],
    ['tone.m4a', 'audio/mp4', 'm4a'],
  ])('%s: %s, its length read from the file', async (name, mimeType, ext) => {
    const audio = await inspectAnnouncement(fixture(name));
    expect(audio).toMatchObject({ mimeType, ext });
    // One second of tone; encoders pad a little (an mp3 or AAC frame here is 0.07-0.15 s).
    expect(audio.durationSec).toBeGreaterThanOrEqual(0.9);
    expect(audio.durationSec).toBeLessThanOrEqual(1.3);
  });

  it.each([
    ['not-audio.mp3', 'a text file named .mp3'],
    ['alaw.wav', 'a WAV Chromium does not decode (A-law)'],
  ])('415 for %s (%s)', async (name) => {
    await expect(inspectAnnouncement(fixture(name))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('415 for nothing at all', async () => {
    await expect(inspectAnnouncement(Buffer.alloc(0))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
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

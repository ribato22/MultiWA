// MultiWA Gateway - what an uploaded announcement really is
// apps/api/src/modules/calls/recordings/announcement-audio.ts
//
// The announcement a caller hears before a recorded call is played by WhatsApp Web's page (Chromium decodes it), and
// the caller waits through it before an agent is connected. So its type and length are read from the file's own
// headers, never from what the client says it is (its file name or Content-Type): one of the formats Chromium plays,
// and at most 30 seconds.
import { UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { parseBuffer } from 'music-metadata';

export const ANNOUNCEMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ANNOUNCEMENT_MAX_SECONDS = 30;
// Encoders pad the end of a file (an mp3 cut at 30 s says 30.03 s): this much over is not "longer".
const PADDING_SECONDS = 0.5;

export interface AnnouncementAudio {
  mimeType: string;
  ext: string;
  durationSec: number;
}

// The container and codec as music-metadata names them, for the formats Chromium decodes.
const FORMATS: Array<{ container: RegExp; codec: RegExp; mimeType: string; ext: string }> = [
  { container: /^MPEG$/, codec: /^MPEG [0-9.]+ Layer 3$/, mimeType: 'audio/mpeg', ext: 'mp3' },
  { container: /^WAVE$/, codec: /^PCM$/, mimeType: 'audio/wav', ext: 'wav' },
  { container: /^Ogg$/, codec: /^(Opus|Vorbis I)$/, mimeType: 'audio/ogg', ext: 'ogg' },
  { container: /^EBML\/webm$/, codec: /^(OPUS|VORBIS)$/, mimeType: 'audio/webm', ext: 'webm' },
  { container: /^M4A\//, codec: /^MPEG-4\/AAC$/, mimeType: 'audio/mp4', ext: 'm4a' },
];

export async function inspectAnnouncement(file: Buffer): Promise<AnnouncementAudio> {
  const format = await parseBuffer(file, undefined, { duration: true, skipCovers: true }).then((m) => m.format, () => null);
  const match = format && FORMATS.find((f) => f.container.test(format.container ?? '') && f.codec.test(format.codec ?? ''));
  if (!format || !match) throw new UnsupportedMediaTypeException('The announcement must be an mp3, wav, ogg, webm or m4a audio file');
  const seconds = format.duration;
  if (!seconds || !Number.isFinite(seconds)) {
    throw new UnprocessableEntityException('The file does not say how long it is (a browser recording, for one): export it again as mp3, ogg or wav');
  }
  if (seconds > ANNOUNCEMENT_MAX_SECONDS + PADDING_SECONDS) {
    throw new UnprocessableEntityException(`The announcement must be at most ${ANNOUNCEMENT_MAX_SECONDS} seconds; this one is ${Math.round(seconds)} seconds`);
  }
  return { mimeType: match.mimeType, ext: match.ext, durationSec: Math.round(seconds * 10) / 10 };
}

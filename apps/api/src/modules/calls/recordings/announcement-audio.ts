// MultiWA Gateway - what an uploaded announcement really is
// apps/api/src/modules/calls/recordings/announcement-audio.ts
//
// The announcement a caller hears before a recorded call is played by WhatsApp Web's page (Chromium decodes it), and
// the caller waits through it before an agent is connected. So its type and length are read from the file itself,
// never from what the client says it is (its file name or Content-Type): one of the formats Chromium plays, and at most
// 30 seconds.
import { Logger, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';

export const ANNOUNCEMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ANNOUNCEMENT_MAX_SECONDS = 30;
// Encoders pad the end of a file, and an mp3's header frame counts in its bytes (30 s of tone at 8 kbps says 30.17 s,
// 30.38 s by its bytes): this much over is not "longer".
const PADDING_SECONDS = 0.5;
// A real file is read in milliseconds; this is for one made to keep the parser busy.
const READ_TIMEOUT_MS = 5000;

export interface AnnouncementAudio {
  mimeType: string;
  ext: string;
  durationSec: number;
}

// The container and codec as music-metadata names them, for the formats Chromium decodes.
const FORMATS: Array<{ container: RegExp; codec: RegExp; mimeType: string; ext: string }> = [
  { container: /^MPEG$/, codec: /^MPEG [0-9.]+ Layer 3$/, mimeType: 'audio/mpeg', ext: 'mp3' },
  // A-law has no name of its own there. WAVE_FORMAT_EXTENSIBLE (`non-PCM (65534)`, ffmpeg's 24-bit) keeps its codec
  // in a GUID music-metadata does not read, so it stays refused.
  { container: /^WAVE$/, codec: /^(PCM|IEEE_FLOAT|non-PCM \(6\))$/, mimeType: 'audio/wav', ext: 'wav' },
  { container: /^Ogg$/, codec: /^(Opus|Vorbis I)$/, mimeType: 'audio/ogg', ext: 'ogg' },
  { container: /^EBML\/webm$/, codec: /^(OPUS|VORBIS)$/, mimeType: 'audio/webm', ext: 'webm' },
  // An MP4's container is its ftyp brands, whatever the major one (ffmpeg's `-f mp4` writes isom/iso2/mp41). Matroska,
  // ASF and AIFF-C copy their codec name from the file, so one of them could call itself MPEG-4/AAC: not those.
  { container: /^(?!EBML\/|ASF\/|AIFF)./, codec: /^MPEG-4\/AAC$/, mimeType: 'audio/mp4', ext: 'm4a' },
];

// music-metadata runs in a worker thread with a time and a memory limit. A malformed file can keep a parser busy for
// seconds (2 MB of 0xFF: 1.8 s and 170 MB of resyncing) or for ever (file-type's ASF loop, now patched), and on this
// thread that would hold every request and timer of the api. The worker requires the module by the path resolved here
// and posts back plain fields only.
const MUSIC_METADATA = createRequire(__filename).resolve('music-metadata');
const READER = `
const { parentPort, workerData } = require('worker_threads');
// skipCovers is load-bearing: with covers read, an ID3 picture with an empty MIME type goes through the same sniffing.
require(workerData.musicMetadata).parseBuffer(workerData.file, undefined, { duration: true, skipCovers: true }).then(
  ({ format: f }) => parentPort.postMessage({ container: f.container, codec: f.codec, duration: f.duration, codecProfile: f.codecProfile, bitrate: f.bitrate }),
  () => parentPort.postMessage(null),
);
`;

interface AudioFormat {
  container?: string;
  codec?: string;
  duration?: number;
  codecProfile?: string;
  bitrate?: number;
}

const logger = new Logger('AnnouncementAudio');
// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** The file's format; null when music-metadata does not know it; 'unreadable' when its reader died or ran out of time. */
function readFormat(file: Buffer, timeoutMs: number): Promise<AudioFormat | null | 'unreadable'> {
  return new Promise((resolve) => {
    const worker = new Worker(READER, { eval: true, workerData: { musicMetadata: MUSIC_METADATA, file }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => {
      logger.warn(`An announcement was not read within ${timeoutMs} ms`);
      resolve('unreadable');
      void worker.terminate();
    }, timeoutMs);
    worker.once('message', (format: AudioFormat | null) => {
      resolve(format);
      void worker.terminate();
    });
    worker.once('error', (e) => {
      logger.warn(`An announcement could not be read: ${clean(e.message)}`);
      resolve('unreadable');
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      resolve('unreadable');
    });
  });
}

/** An ID3v2 tag's length: its 10-byte header plus the size in bytes 6-9, 7 bits each. */
function id3v2Length(file: Buffer): number {
  if (file.length < 10 || file.toString('latin1', 0, 3) !== 'ID3') return 0;
  return 10 + (((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) | ((file[8] & 0x7f) << 7) | (file[9] & 0x7f));
}

export async function inspectAnnouncement(file: Buffer, { timeoutMs = READ_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<AnnouncementAudio> {
  const format = await readFormat(file, timeoutMs);
  if (format === 'unreadable') throw new UnsupportedMediaTypeException('The announcement file could not be read: export it again as mp3, ogg or wav');
  const match = format && FORMATS.find((f) => f.container.test(format.container ?? '') && f.codec.test(format.codec ?? ''));
  if (!format || !match) throw new UnsupportedMediaTypeException('The announcement must be an mp3, wav (PCM, float or A-law), ogg, webm or m4a audio file');
  // An mp3's Info header and a WAV's fact chunk are claims the player does not follow: two mp3 files back to back keep
  // the first one's header. At a constant bitrate the bytes say how long it plays, so the longer of the two counts.
  // Ogg, WebM and MP4 state only a nominal bitrate.
  const constantRate = match.ext === 'wav' || (match.ext === 'mp3' && format.codecProfile === 'CBR');
  const fromBytes = constantRate && format.bitrate ? ((file.length - id3v2Length(file)) * 8) / format.bitrate : 0;
  const seconds = Math.max(format.duration ?? 0, fromBytes);
  if (!(seconds > 0 && Number.isFinite(seconds))) {
    throw new UnprocessableEntityException('The file does not say how long it is (a browser recording, for one): export it again as mp3, ogg or wav');
  }
  if (seconds > ANNOUNCEMENT_MAX_SECONDS + PADDING_SECONDS) {
    throw new UnprocessableEntityException(`The announcement must be at most ${ANNOUNCEMENT_MAX_SECONDS} seconds; this one is ${Math.round(seconds)} seconds`);
  }
  return { mimeType: match.mimeType, ext: match.ext, durationSec: Math.round(seconds * 10) / 10 };
}

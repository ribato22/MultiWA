// MultiWA Gateway - what an uploaded announcement really is
// apps/api/src/modules/calls/recordings/announcement-audio.ts
//
// The announcement a caller hears before a recorded call is played by WhatsApp Web's page (Chromium decodes it), and
// the caller waits through it before an agent is connected. So its type and length are read from the file itself,
// never from what the client says it is (its file name or Content-Type): one of the formats Chromium plays, and at most
// 30 seconds.
import { Logger, ServiceUnavailableException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';

export const ANNOUNCEMENT_MAX_BYTES = 2 * 1024 * 1024;
export const ANNOUNCEMENT_MAX_SECONDS = 30;
// Encoders pad the end of a file, and an mp3's header frame is one of its frames (30 s of tone at 8 kbps says 30.17 s
// in its Info header, 30.24 s by its frames): this much over is not "longer".
const PADDING_SECONDS = 0.5;
// A real file is read in milliseconds; this is for one made to keep the parser busy.
const READ_TIMEOUT_MS = 5000;
// Readers at once: a hostile file holds one at its memory cap (below) for seconds. The next is turned away (503), not
// queued: uploads are an owner's or admin's, and rare.
const MAX_READS_AT_ONCE = 2;
let reading = 0;

export interface AnnouncementAudio {
  mimeType: string;
  ext: string;
  durationSec: number;
}

// The container and codec as music-metadata names them, for the formats Chromium decodes.
const FORMATS: Array<{ container: RegExp; codec: RegExp; bitsPerSample?: number; mimeType: string; ext: string }> = [
  { container: /^MPEG$/, codec: /^MPEG [0-9.]+ Layer 3$/, mimeType: 'audio/mpeg', ext: 'mp3' },
  // A-law and µ-law (formats 6 and 7) have no name of their own there. WAVE_FORMAT_EXTENSIBLE (`non-PCM (65534)`,
  // ffmpeg's 24-bit) keeps its codec in a GUID music-metadata does not read, so it stays refused.
  { container: /^WAVE$/, codec: /^(PCM|non-PCM \([67]\))$/, mimeType: 'audio/wav', ext: 'wav' },
  // Chromium decodes 32-bit float and fails on 64-bit.
  { container: /^WAVE$/, codec: /^IEEE_FLOAT$/, bitsPerSample: 32, mimeType: 'audio/wav', ext: 'wav' },
  { container: /^Ogg$/, codec: /^(Opus|Vorbis I)$/, mimeType: 'audio/ogg', ext: 'ogg' },
  { container: /^EBML\/webm$/, codec: /^(OPUS|VORBIS)$/, mimeType: 'audio/webm', ext: 'webm' },
  // An MP4's container is its ftyp brands, whatever the major one (ffmpeg's `-f mp4` writes isom/iso2/mp41). Matroska,
  // ASF and AIFF-C copy their codec name from the file, so one of them could call itself MPEG-4/AAC: not those.
  { container: /^(?!EBML\/|ASF\/|AIFF)./, codec: /^MPEG-4\/AAC$/, mimeType: 'audio/mp4', ext: 'm4a' },
];

// music-metadata runs in a worker thread with a time and a memory limit. A malformed file can keep a parser busy for
// seconds (2 MB of 0xFF: 1.8 s and 170 MB of resyncing) or for ever (file-type's ASF loop, now patched), and on this
// thread that would hold every request and timer of the api. Its memory cap is about 224 MB: 128 MB of old space plus
// the young generation. A process-wide --max-old-space-size (on the command line or in NODE_OPTIONS) overrides
// resourceLimits and lifts the cap; the image runs `node dist/main.js` without one, so it holds there. The worker
// requires the module by the path resolved here and posts back plain fields only.
const MUSIC_METADATA = createRequire(__filename).resolve('music-metadata');
const READER = `
const { parentPort, workerData } = require('worker_threads');
// skipCovers is load-bearing: with covers read, an ID3 picture with an empty MIME type goes through the same sniffing.
require(workerData.musicMetadata).parseBuffer(workerData.file, undefined, { duration: true, skipCovers: true }).then(
  ({ format: f }) => parentPort.postMessage({ container: f.container, codec: f.codec, duration: f.duration, sampleRate: f.sampleRate, numberOfChannels: f.numberOfChannels, bitsPerSample: f.bitsPerSample }),
  () => parentPort.postMessage(null),
);
`;

interface AudioFormat {
  container?: string;
  codec?: string;
  duration?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  bitsPerSample?: number;
}

const logger = new Logger('AnnouncementAudio');
// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** The file's format; null when music-metadata does not know it; 'unreadable' when its reader died or ran out of time. */
function readFormat(file: Buffer, timeoutMs: number): Promise<AudioFormat | null | 'unreadable'> {
  return new Promise((resolve) => {
    const worker = new Worker(READER, { eval: true, workerData: { musicMetadata: MUSIC_METADATA, file }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    // The first of the answer, an error, the exit and the time limit decides, and says why; what follows is its echo
    // (terminate() makes the thread exit, and an error is followed by an exit).
    let settled = false;
    const settle = (result: AudioFormat | null | 'unreadable', warning?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (warning) logger.warn(warning);
      resolve(result);
      void worker.terminate();
    };
    const timer = setTimeout(() => settle('unreadable', `An announcement was not read within ${timeoutMs} ms`), timeoutMs);
    worker.once('message', (format: AudioFormat | null) => settle(format));
    worker.once('error', (e) => settle('unreadable', `An announcement could not be read: ${clean(e.message)}`));
    worker.once('exit', (code) => settle('unreadable', `An announcement's reader exited with code ${clean(code)} before it answered`));
  });
}

/** An ID3v2 tag's length: its 10-byte header plus the size in bytes 6-9, 7 bits each. */
function id3v2Length(file: Buffer): number {
  if (file.length < 10 || file.toString('latin1', 0, 3) !== 'ID3') return 0;
  return 10 + (((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) | ((file[8] & 0x7f) << 7) | (file[9] & 0x7f));
}

// Layer III bitrates in kbps by their index: MPEG 2 and 2.5, then MPEG 1.
const LAYER3_KBPS = [
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];

/**
 * How long an mp3 plays: its Layer III frames after the ID3v2 tag, walked as a decoder walks them, each 1152 or 576
 * samples at its own rate. A byte that starts no valid header (version 01, bitrate index 0 or 15 or sample-rate index 3
 * are none) is stepped over, as a decoder resyncs. One pass over at most 2 MB: a few ms, on this thread.
 */
function mp3Seconds(file: Buffer): number {
  let seconds = 0;
  for (let i = id3v2Length(file); i + 4 <= file.length; ) {
    const version = (file[i + 1] >> 3) & 3; // 0 MPEG 2.5, 2 MPEG 2, 3 MPEG 1
    const bitrate = file[i + 2] >> 4;
    const rate = (file[i + 2] >> 2) & 3;
    if (file[i] !== 0xff || (file[i + 1] & 0xe6) !== 0xe2 || version === 1 || bitrate === 0 || bitrate === 15 || rate === 3) {
      i++;
      continue;
    }
    const hz = [44100, 48000, 32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const samples = version === 3 ? 1152 : 576;
    seconds += samples / hz;
    i += Math.floor(((samples / 8) * LAYER3_KBPS[version === 3 ? 1 : 0][bitrate] * 1000) / hz) + ((file[i + 2] >> 1) & 1);
  }
  return seconds;
}

/**
 * How long a WAV plays: the bytes of its data chunks at the rate its sample format makes, as decoders read them. The
 * other chunks are no audio, and can be long: afconvert pads its header to 4 KB (half a second of µ-law). A data
 * chunk's size of 0 or 0xFFFFFFFF was never filled in (its writer could not seek back): the rest of the file is audio.
 */
function wavSeconds(file: Buffer, { sampleRate = 0, numberOfChannels = 0, bitsPerSample = 0 }: AudioFormat): number {
  let bytes = 0;
  for (let i = 12; i + 8 <= file.length; ) {
    const size = file.readUInt32LE(i + 4);
    const left = file.length - i - 8;
    if (file.toString('latin1', i, i + 4) === 'data') {
      if (size === 0 || size === 0xffffffff) {
        bytes += left;
        break;
      }
      bytes += Math.min(size, left);
    }
    i += 8 + size + (size & 1); // a chunk of an odd size is followed by a pad byte
  }
  return (bytes * 8) / (sampleRate * numberOfChannels * bitsPerSample);
}

export async function inspectAnnouncement(file: Buffer, { timeoutMs = READ_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<AnnouncementAudio> {
  if (reading >= MAX_READS_AT_ONCE) throw new ServiceUnavailableException('Another announcement is being read; try again in a moment');
  reading++;
  const format = await readFormat(file, timeoutMs).finally(() => reading--);
  if (format === 'unreadable') throw new UnsupportedMediaTypeException('The announcement file could not be read: export it again as mp3, ogg or wav');
  const match =
    format &&
    FORMATS.find((f) => f.container.test(format.container ?? '') && f.codec.test(format.codec ?? '') && (f.bitsPerSample === undefined || f.bitsPerSample === format.bitsPerSample));
  if (!format || !match) throw new UnsupportedMediaTypeException('The announcement must be an mp3, wav (PCM, 32-bit float, A-law or µ-law), ogg, webm or m4a audio file');
  // A header's length is a claim the player does not follow. An mp3's length is its frames alone: music-metadata's is
  // its Info or Xing header (two files back to back keep the first one's) or, without one, a guess from the file's size
  // at the bitrate its first three frames share, which a quiet start makes far too long. A WAV's fact chunk and block
  // size are not what its decoder reads either, so its data is counted too, and the longer counts. Ogg, WebM and MP4
  // have no such count here.
  const seconds = match.ext === 'mp3' ? mp3Seconds(file) : Math.max(format.duration ?? 0, match.ext === 'wav' ? wavSeconds(file, format) : 0);
  if (!(seconds > 0 && Number.isFinite(seconds))) {
    throw new UnprocessableEntityException('The file does not say how long it is (a browser recording, for one): export it again as mp3, ogg or wav');
  }
  if (seconds > ANNOUNCEMENT_MAX_SECONDS + PADDING_SECONDS) {
    throw new UnprocessableEntityException(`The announcement must be at most ${ANNOUNCEMENT_MAX_SECONDS} seconds; this one is ${Math.round(seconds)} seconds`);
  }
  return { mimeType: match.mimeType, ext: match.ext, durationSec: Math.round(seconds * 10) / 10 };
}

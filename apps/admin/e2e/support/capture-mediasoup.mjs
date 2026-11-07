// Writes mediasoup.json: what the admin's e2e replays for `call:media` in place of a media server. A real mediasoup
// worker (resolved from apps/api) with the router the API makes (CALL_MEDIA_CODECS in
// apps/api/src/modules/calls/media/call-media.service.ts): its capabilities, a receive and a send transport, and the
// agent's consumers of a caller's voice and video, on that receive transport. Its ids are made stable, so the tests can
// name them. Run it again when the API's router changes: node apps/admin/e2e/support/capture-mediasoup.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mediasoup = createRequire(join(here, '../../../api/package.json'))('mediasoup');

const CALL_MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 },
];

const worker = await mediasoup.createWorker({ logLevel: 'warn' });
try {
  const router = await worker.createRouter({ mediaCodecs: CALL_MEDIA_CODECS });
  const transport = () => router.createWebRtcTransport({ listenInfos: [{ protocol: 'udp', ip: '127.0.0.1' }] });
  const params = (t, id) => ({ id, iceParameters: t.iceParameters, iceCandidates: t.iceCandidates, dtlsParameters: t.dtlsParameters });
  // The caller, as the WhatsApp Web page's bridge produces it: its voice and its picture.
  const page = await transport();
  const voice = await page.produce({
    kind: 'audio',
    rtpParameters: {
      codecs: [{ mimeType: 'audio/opus', payloadType: 100, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [{ type: 'transport-cc' }] }],
      encodings: [{ ssrc: 11111111 }],
    },
  });
  const picture = await page.produce({
    kind: 'video',
    rtpParameters: {
      codecs: [{
        mimeType: 'video/VP8', payloadType: 101, clockRate: 90000, parameters: {},
        rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'ccm', parameter: 'fir' }, { type: 'transport-cc' }],
      }],
      encodings: [{ ssrc: 22222222, maxBitrate: 800000 }],
    },
  });
  const recv = await transport();
  const send = await transport();
  const consumer = async (producer, id, producerId) => {
    const c = await recv.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities, paused: true });
    return { id, producerId, kind: c.kind, rtpParameters: c.rtpParameters };
  };
  const out = {
    routerRtpCapabilities: router.rtpCapabilities,
    recv: params(recv, 'recv-transport'),
    send: params(send, 'send-transport'),
    consumer: await consumer(voice, 'caller-consumer', 'caller-producer'),
    videoConsumer: await consumer(picture, 'caller-video-consumer', 'caller-video-producer'),
  };
  writeFileSync(join(here, 'mediasoup.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`mediasoup.json: ${out.routerRtpCapabilities.codecs.map((c) => c.mimeType).join(', ')}; consumers ${out.consumer.kind}, ${out.videoConsumer.kind}`);
} finally {
  worker.close();
}

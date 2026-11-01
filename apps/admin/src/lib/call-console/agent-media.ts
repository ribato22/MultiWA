// The agent's side of a call answered in the dashboard: mediasoup-client against the call's media room, signalled over
// the `call:media` socket command. Framework-free: the API's media integration specs run this very file in a browser.
import { Device, type types } from 'mediasoup-client';
import type { LinkSample } from './call-quality';

/** One `call:media` operation: resolves with its result, rejects with the server's reason. */
export type MediaSignal = (op: string, args?: Record<string, unknown>) => Promise<any>;

export interface AgentMediaOptions {
  signal: MediaSignal;
  /** From the reply to `call:answer` or `call:rejoin`. */
  callerProducerId: string;
  iceServers: RTCIceServer[];
  /** The agent's microphone, already open: it becomes the agent's voice. */
  mic: MediaStreamTrack;
}

export interface AgentMedia {
  /** The caller's voice, for an audio element. */
  readonly remote: MediaStream;
  /** The server's id of the agent's voice. */
  readonly producerId: string;
  /** Mute is the microphone track's `enabled`: the agent stays connected, and the caller hears silence. */
  setMuted(muted: boolean): void;
  /** Another microphone mid-call, muted if the call is; the previous track is stopped. */
  replaceMic(track: MediaStreamTrack): Promise<void>;
  /** The link's round trip, jitter and loss, for the in-call bar. */
  sample(): Promise<LinkSample>;
  /** `cb` runs once if a transport fails (the network, or the server closed this peer): the call's audio is gone. */
  onFailed(cb: () => void): void;
  /** Stops the microphone and closes the transports; safe to call twice. */
  close(): void;
}

/**
 * Connects the agent in the order the server watches for: the caller is consumed and resumed first, then the agent's
 * voice is produced, and the agent counts as connected once both are done. A failure closes what was opened and stops
 * the microphone.
 */
export async function startAgentMedia({ signal, callerProducerId, iceServers, mic }: AgentMediaOptions): Promise<AgentMedia> {
  const transports: types.Transport[] = [];
  let track = mic;
  let muted = false;
  let closed = false;
  let failed: (() => void) | null = null;
  let failedOnce = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const t of transports) t.close();
    track.stop();
  };
  try {
    const device = await Device.factory();
    await device.load({ routerRtpCapabilities: await signal('rtpCapabilities') });
    const open = async (direction: 'send' | 'recv') => {
      const params = await signal('createTransport', { direction });
      const t = direction === 'send' ? device.createSendTransport({ ...params, iceServers }) : device.createRecvTransport({ ...params, iceServers });
      transports.push(t);
      t.on('connect', ({ dtlsParameters }, ok, fail) => {
        signal('connectTransport', { transportId: t.id, dtlsParameters }).then(() => ok(), fail);
      });
      t.on('connectionstatechange', (state) => {
        if (state !== 'failed' || closed || failedOnce) return;
        failedOnce = true;
        failed?.();
      });
      return t;
    };
    const recv = await open('recv');
    const consumer = await recv.consume(await signal('consume', { transportId: recv.id, producerId: callerProducerId, rtpCapabilities: device.rtpCapabilities }));
    await signal('resumeConsumer', { consumerId: consumer.id });
    const send = await open('send');
    send.on('produce', ({ kind, rtpParameters }, ok, fail) => {
      signal('produce', { transportId: send.id, kind, rtpParameters }).then(ok, fail);
    });
    const producer = await send.produce({ track });

    let last = { lost: 0, received: 0 };
    const sample = async (): Promise<LinkSample> => {
      const out: LinkSample = {};
      const worst = (key: keyof LinkSample, value: number) => {
        out[key] = Math.max(out[key] ?? 0, value);
      };
      (await send.getStats()).forEach((s: any) => {
        // What the server reports about the agent's voice (RTCP), with the ICE round trip as a fallback.
        if (s.type === 'remote-inbound-rtp') {
          if (s.roundTripTime != null) out.rttMs = s.roundTripTime * 1000;
          if (s.fractionLost != null) worst('lossPct', s.fractionLost * 100);
          if (s.jitter != null) worst('jitterMs', s.jitter * 1000);
        }
        if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) out.rttMs ??= s.currentRoundTripTime * 1000;
      });
      (await recv.getStats()).forEach((s: any) => {
        // The caller's voice as it arrives: jitter, and the packets lost since the last sample.
        if (s.type !== 'inbound-rtp' || s.kind !== 'audio') return;
        if (s.jitter != null) worst('jitterMs', s.jitter * 1000);
        const lost = Math.max(0, (s.packetsLost ?? 0) - last.lost);
        const received = Math.max(0, (s.packetsReceived ?? 0) - last.received);
        if (lost + received > 0) worst('lossPct', (100 * lost) / (lost + received));
        last = { lost: s.packetsLost ?? 0, received: s.packetsReceived ?? 0 };
      });
      return out;
    };

    return {
      remote: new MediaStream([consumer.track]),
      producerId: producer.id,
      setMuted(on) {
        muted = on;
        track.enabled = !on;
      },
      async replaceMic(next) {
        next.enabled = !muted;
        await producer.replaceTrack({ track: next });
        track = next;
      },
      sample,
      onFailed(cb) {
        failed = cb;
      },
      close,
    };
  } catch (e) {
    close();
    throw e;
  }
}

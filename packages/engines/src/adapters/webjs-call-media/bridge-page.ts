// MultiWA Gateway - the call's media bridge inside the WhatsApp Web page
// packages/engines/src/adapters/webjs-call-media/bridge-page.ts
//
// Runs INSIDE the WhatsApp Web page (page.evaluate), like ./page, so every function is self-contained: no imports, no
// closures over module scope; the engines target (ES2021) keeps them free of TypeScript helpers. The bridge is a
// mediasoup-client peer of the call's media room on the server:
// - it produces "caller": silence first (WhatsApp Web plays the caller only after it accepted the call), then
//   WhatsApp Web's own playback of the caller (`__mwCall.callerTap`, attachCallerInPage);
// - it consumes "agent" into the injected microphone (`__mwCall.inputs.agent`), which WhatsApp Web sends to the caller.
// mediasoup-client comes from the bundle the wrapper evaluates first (`window.mediasoupClient`). The signalling goes
// through ONE page binding, `__mwBridgeSignal(callId, op, json)`, to the room. One bridge per document:
// `window.__mwBridge`. The interface below is types only, erased at compile time.

/** `window.__mwBridge`: the media bridge of the current call. */
export interface MwBridge {
  callId: string;
  device: any;
  send: any;
  recv: any;
  /** The "caller" producer: silence until attachCallerInPage swaps in WhatsApp Web's playback. */
  caller: any;
  /** The agent on the microphone (connectAgentInPage), or none. */
  agent: { consumer: any; source: MediaStreamAudioSourceNode; keepAlive: HTMLAudioElement } | null;
  /** Releases everything the bridge holds in the page, synchronously; safe to call twice. */
  teardown(): void;
}

/** mediasoup-client is already evaluated into this document. */
export function hasMediasoupClient(): boolean {
  return typeof (window as any).mediasoupClient?.Device === 'function';
}

/**
 * Start the bridge for the RINGING call `callId`: load the room's capabilities, create the send and receive
 * transports, and produce "caller" on silence. One bridge per page: a second start is refused, also while the first
 * one still runs; a start that fails releases what it created.
 */
export async function startBridgeInPage(callId: string): Promise<{ callerProducerId: string }> {
  const w = window as any;
  const c = w.require('WAWebCallCollection').activeCall;
  if (!c || String(c.id) !== callId || (w._multiwaCallId && w._multiwaCallId !== callId)) {
    throw new Error('Call is not the active call');
  }
  if (typeof w.mediasoupClient?.Device !== 'function') throw new Error('mediasoup-client missing');
  if (typeof w.__mwBridgeSignal !== 'function') throw new Error('Media bridge binding missing');
  if (w.__mwBridge) throw new Error('Media bridge already running');
  const call = w.__mwCall.ensure();
  const signal = async (op: string, args: unknown = {}) => JSON.parse(await w.__mwBridgeSignal(callId, op, JSON.stringify(args)));
  // A destination without input sends no frames at all: a silent constant source keeps "caller" a live stream.
  const dest = call.ctx.createMediaStreamDestination();
  (dest.stream as any).__mwOwn = true;
  const silence = call.ctx.createConstantSource();
  silence.offset.value = 0;
  silence.connect(dest);
  silence.start();
  // Claimed before the first await, so a second start is refused even while this one runs.
  const b: MwBridge = {
    callId,
    device: null,
    send: null,
    recv: null,
    caller: null,
    agent: null,
    teardown() {
      if (b.agent) {
        b.agent.source.disconnect();
        b.agent.keepAlive.srcObject = null;
        b.agent.consumer.close();
        b.agent = null;
      }
      try { b.send?.close(); } catch { /* closes "caller" too; stopTracks false leaves WhatsApp Web's track running */ }
      try { b.recv?.close(); } catch { /* already closed */ }
      try { silence.stop(); } catch { /* already stopped */ }
      silence.disconnect();
    },
  };
  w.__mwBridge = b;
  try {
    // WhatsApp Web's user agent says Chrome 101 (whatsapp-web.js) and a headless one is not detected at all: this is
    // a current Chromium, so the handler is named instead of guessed from the user agent.
    b.device = new w.mediasoupClient.Device({ handlerName: 'Chrome111' });
    await b.device.load({ routerRtpCapabilities: await signal('rtpCapabilities') });
    const wire = (t: any) => {
      t.on('connect', ({ dtlsParameters }: any, ok: () => void, fail: (e: Error) => void) => {
        signal('connectTransport', { transportId: t.id, dtlsParameters }).then(() => ok(), fail);
      });
      return t;
    };
    b.send = wire(b.device.createSendTransport(await signal('createTransport', { direction: 'send' })));
    b.send.on('produce', ({ kind, rtpParameters }: any, ok: (r: { id: string }) => void, fail: (e: Error) => void) => {
      signal('produce', { transportId: b.send.id, kind, rtpParameters }).then(ok, fail);
    });
    b.recv = wire(b.device.createRecvTransport(await signal('createTransport', { direction: 'recv' })));
    // stopTracks false: replacing or closing "caller" must never stop the track it carries (later WhatsApp Web's own).
    b.caller = await b.send.produce({ track: dest.stream.getAudioTracks()[0], stopTracks: false });
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    return { callerProducerId: b.caller.id };
  } catch (e) {
    b.teardown();
    if (w.__mwBridge === b) delete w.__mwBridge;
    throw e;
  }
}

/**
 * Swap "caller" from silence to WhatsApp Web's playback of the caller (callerTap, up to 5 s). Resolves with how the tap
 * was chosen (MwTapPick): more than one fresh candidate, or the fallback, means the pick was a guess.
 */
export async function attachCallerInPage(callId: string): Promise<{ via: string; freshCandidates: number; fallback: boolean }> {
  const w = window as any;
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId || !b.caller) throw new Error('No media bridge for this call');
  const tap = await w.__mwCall.callerTap(5000);
  if (w.__mwBridge !== b) throw new Error('Media bridge closed');
  if (!tap) throw new Error('No caller audio');
  await b.caller.replaceTrack({ track: tap.stream.getAudioTracks()[0] });
  return { via: tap.via, freshCandidates: tap.freshCandidates, fallback: tap.fallback };
}

/** Consume the agent's producer into the call's microphone (`inputs.agent`). One agent at a time. */
export async function connectAgentInPage(callId: string, producerId: string): Promise<void> {
  const w = window as any;
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId || !b.recv) throw new Error('No media bridge for this call');
  if (b.agent) throw new Error('Agent already connected');
  const signal = async (op: string, args: unknown) => JSON.parse(await w.__mwBridgeSignal(callId, op, JSON.stringify(args)));
  const consumer = await b.recv.consume(
    await signal('consume', { transportId: b.recv.id, producerId, rtpCapabilities: b.device.rtpCapabilities }),
  );
  if (w.__mwBridge !== b || b.agent) {
    consumer.close();
    throw new Error(w.__mwBridge !== b ? 'Media bridge closed' : 'Agent already connected');
  }
  // Chrome feeds a remote track to Web Audio only while a media element plays it: a muted keep-alive, marked as ours
  // BEFORE its srcObject is set, or tap A would take the agent for the caller.
  const stream = new MediaStream([consumer.track]);
  (stream as any).__mwOwn = true;
  const keepAlive = new Audio();
  keepAlive.muted = true;
  keepAlive.srcObject = stream;
  keepAlive.play().catch(() => {});
  const call = w.__mwCall;
  const source = call.ctx.createMediaStreamSource(stream);
  source.connect(call.inputs.agent);
  b.agent = { consumer, source, keepAlive };
  await signal('resumeConsumer', { consumerId: consumer.id });
}

/** Take the agent off the microphone, by disconnecting it (not by gain). Does nothing when no agent is connected. */
export async function disconnectAgentInPage(callId: string): Promise<void> {
  const w = window as any;
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId) throw new Error('No media bridge for this call');
  const a = b.agent;
  if (!a) return;
  b.agent = null;
  a.source.disconnect();
  a.keepAlive.srcObject = null;
  a.consumer.close();
  await w.__mwBridgeSignal(callId, 'closeConsumer', JSON.stringify({ consumerId: a.consumer.id })).catch(() => undefined);
}

/** Close the bridge of `callId` and release what it holds in the page. Idempotent; another call's bridge stays. */
export function closeBridgeInPage(callId: string): { closed: boolean } {
  const w = window as any;
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId) return { closed: false };
  delete w.__mwBridge;
  b.teardown();
  return { closed: true };
}

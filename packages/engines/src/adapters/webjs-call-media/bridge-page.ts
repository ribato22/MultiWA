// MultiWA Gateway - the call's media bridge inside the WhatsApp Web page
// packages/engines/src/adapters/webjs-call-media/bridge-page.ts
//
// Runs INSIDE the WhatsApp Web page (page.evaluate), like ./page, so every function is self-contained: no imports, no
// closures over module scope; the engines target (ES2021) keeps them free of TypeScript helpers. That is why each
// per-call function repeats the same call-id guard. The bridge is a mediasoup-client peer of the call's media room on
// the server:
// - it produces "caller": silence first (WhatsApp Web plays the caller only after it accepted the call), then
//   WhatsApp Web's own playback of the caller (`__mwCall.callerTap`, attachCallerInPage);
// - it consumes "agent" into the injected microphone (`__mwCall.inputs.agent`), which WhatsApp Web sends to the caller.
// mediasoup-client comes from the bundle the wrapper evaluates first (`window.mediasoupClient`). The signalling goes
// through ONE page binding, `__mwBridgeSignal(callId, op, json)`, to the room. One bridge per document:
// `window.__mwBridge`, tied to its call: it ends with it (startBridgeInPage). The interface below is types only,
// erased at compile time.

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
  /** Releases everything the bridge holds in the page, synchronously, the call poll included; safe to call twice. */
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
 * The bridge ends with its call, or the agent would reach the NEXT call's microphone. Once it is up, the call is
 * polled every 250 ms, like the recorder's (startRecordingInPage): when it is over on two polls in a row (so 250-500 ms
 * after the end) the page releases everything. A call is over when the call-id guard fails (WhatsApp's active call is
 * another call, or none), when the whatsapp-web.js patch that tracks the call reports it ended (it clears
 * `_multiwaCallId`; a call the patch did not track at the start is judged by the guard alone), or when the call state
 * cannot be read. attachCallerInPage and connectAgentInPage apply the same guard.
 */
export async function startBridgeInPage(callId: string): Promise<{ callerProducerId: string }> {
  const w = window as any;
  if (!w.__mwCall) throw new Error('Call media hooks missing');
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  // The patch clears `_multiwaCallId` when it ends the call, also for one that stays in WhatsApp's active call (where
  // `ours` lets an unset id pass): a call it tracked (read before the first await) and no longer does is over.
  const tracked = w._multiwaCallId === callId;
  const over = () => !ours() || (tracked && w._multiwaCallId !== callId);
  if (!ours()) throw new Error('Call is not the active call');
  if (typeof w.mediasoupClient?.Device !== 'function') throw new Error('mediasoup-client missing');
  if (typeof w.__mwBridgeSignal !== 'function') throw new Error('Media bridge binding missing');
  if (w.__mwBridge) throw new Error('Media bridge already running');
  const call = w.__mwCall.ensure();
  // The binding serves whichever bridge slot is current, by call id. A start the coordinator gave up on (and a retry
  // of the same call replaced) must not signal into the retry's room: once closed, its next message fails here.
  const signal = async (op: string, args: unknown = {}) => {
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    return JSON.parse(await w.__mwBridgeSignal(callId, op, JSON.stringify(args)));
  };
  // A destination without input sends no frames at all: a silent constant source keeps "caller" a live stream.
  const dest = call.ctx.createMediaStreamDestination();
  (dest.stream as any).__mwOwn = true;
  const silence = call.ctx.createConstantSource();
  silence.offset.value = 0;
  silence.connect(dest);
  silence.start();
  let poll: any;
  // Claimed before the first await, so a second start is refused even while this one runs.
  const b: MwBridge = {
    callId,
    device: null,
    send: null,
    recv: null,
    caller: null,
    agent: null,
    teardown() {
      clearInterval(poll);
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
    // disableTrackOnPause false: replaceTrack must not write `enabled` on it either.
    b.caller = await b.send.produce({ track: dest.stream.getAudioTracks()[0], stopTracks: false, disableTrackOnPause: false });
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    let gone = 0;
    poll = setInterval(() => {
      try { gone = over() ? gone + 1 : 0; } catch { gone++; } // a call state that cannot be read is not a live call
      if (gone >= 2) {
        if (w.__mwBridge === b) delete w.__mwBridge;
        b.teardown();
      }
    }, 250);
    return { callerProducerId: b.caller.id };
  } catch (e) {
    b.teardown();
    if (w.__mwBridge === b) delete w.__mwBridge;
    throw e;
  }
}

/**
 * Swap "caller" from silence to WhatsApp Web's playback of the caller (callerTap, up to 5 s). Resolves with how the tap
 * was chosen (MwTapPick): more than one fresh candidate, or the fallback, means the pick was a guess. Refused when the
 * call is not WhatsApp's active call, also when it ended during the wait for the tap.
 */
export async function attachCallerInPage(callId: string): Promise<{ via: 'element' | 'destination'; freshCandidates: number; fallback: boolean }> {
  const w = window as any;
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId || !b.caller) throw new Error('No media bridge for this call');
  if (!ours()) throw new Error('Call is not the active call');
  const tap = await w.__mwCall.callerTap(5000);
  if (w.__mwBridge !== b) throw new Error('Media bridge closed');
  if (!ours()) throw new Error('Call is not the active call');
  if (!tap) throw new Error('No caller audio');
  await b.caller.replaceTrack({ track: tap.stream.getAudioTracks()[0] });
  return { via: tap.via, freshCandidates: tap.freshCandidates, fallback: tap.fallback };
}

/**
 * Consume the agent's producer into the call's microphone (`inputs.agent`). One agent at a time. Refused when the call
 * is not WhatsApp's active call, before and after every wait; a connect that fails after the room created its consumer
 * undoes all of it (the agent off the microphone, the consumer closed on both sides) and rejects, so a retry starts clean.
 */
export async function connectAgentInPage(callId: string, producerId: string): Promise<void> {
  const w = window as any;
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId || !b.recv) throw new Error('No media bridge for this call');
  if (b.agent) throw new Error('Agent already connected');
  if (!ours()) throw new Error('Call is not the active call');
  const signal = async (op: string, args: unknown) => JSON.parse(await w.__mwBridgeSignal(callId, op, JSON.stringify(args)));
  const options = await signal('consume', { transportId: b.recv.id, producerId, rtpCapabilities: b.device.rtpCapabilities });
  const live = () => {
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    if (!ours()) throw new Error('Call is not the active call');
  };
  let consumer: any;
  let source: MediaStreamAudioSourceNode | undefined;
  let keepAlive: HTMLAudioElement | undefined;
  let mine: MwBridge['agent'] = null;
  try {
    live();
    consumer = await b.recv.consume(options);
    live();
    if (b.agent) throw new Error('Agent already connected');
    // Chrome feeds a remote track to Web Audio only while a media element plays it: a muted keep-alive, marked as ours
    // BEFORE its srcObject is set, or tap A would take the agent for the caller.
    const stream = new MediaStream([consumer.track]);
    (stream as any).__mwOwn = true;
    keepAlive = new Audio();
    keepAlive.muted = true;
    keepAlive.srcObject = stream;
    keepAlive.play().catch(() => {});
    const call = w.__mwCall.ensure();
    source = call.ctx.createMediaStreamSource(stream);
    source.connect(call.inputs.agent);
    b.agent = mine = { consumer, source, keepAlive };
    await signal('resumeConsumer', { consumerId: consumer.id });
    live();
  } catch (e) {
    source?.disconnect();
    if (keepAlive) keepAlive.srcObject = null;
    consumer?.close();
    if (mine && b.agent === mine) b.agent = null;
    try {
      await w.__mwBridgeSignal(callId, 'closeConsumer', JSON.stringify({ consumerId: options.id }));
    } catch { /* best effort: the room closes its consumers with the room */ }
    throw e;
  }
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

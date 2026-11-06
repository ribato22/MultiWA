// MultiWA Gateway - the call's media bridge inside the WhatsApp Web page
// packages/engines/src/adapters/webjs-call-media/bridge-page.ts
//
// Runs INSIDE the WhatsApp Web page (page.evaluate), like ./page, so every function is self-contained: no imports, no
// closures over module scope; the engines target (ES2021) keeps them free of TypeScript helpers. That is why each
// per-call function repeats the same call-id guard. The bridge is a mediasoup-client peer of the call's media room on
// the server:
// - it produces "caller": silence first (WhatsApp Web plays the caller only after it accepted the call), then
//   WhatsApp Web's own playback of the caller (`__mwCall.callerTap`, attachCallerInPage); on a video call it also
//   produces "callerVideo": black first, then WhatsApp Web's own drawing of the caller (attachCallerVideoInPage);
// - it consumes "agent" into the injected microphone (`__mwCall.inputs.agent`), which WhatsApp Web sends to the caller,
//   and on a video call the agent's video into the injected camera (`__mwCall.camera`, connectAgentVideoInPage).
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
  /**
   * The "callerVideo" producer, on a video call only (else null): a black placeholder, redrawn every second, until
   * attachCallerVideoInPage swaps in a capture of WhatsApp Web's canvas of the caller.
   */
  callerVideo: any;
  /** The canvas of WhatsApp Web's that "callerVideo" carries a capture of, once attached. */
  callerCanvas: HTMLCanvasElement | null;
  /**
   * What keeps "callerVideo" sending, one timer for both: the placeholder's redraw until the attach's first capture
   * replaced it, then the poll that keeps it on WhatsApp Web's largest canvas (attachCallerVideoInPage).
   */
  callerVideoPoll: any;
  /** The agent's video on the injected camera (connectAgentVideoInPage), or none. */
  agentVideo: { consumer: any; view: HTMLVideoElement } | null;
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
 * With `video` it also produces "callerVideo" on a black placeholder. Best effort: a video the room refuses leaves a
 * voice bridge (`callerVideoProducerId` null, `videoError` says why), never a failed start.
 */
export async function startBridgeInPage(
  callId: string,
  video = false,
): Promise<{ callerProducerId: string; callerVideoProducerId: string | null; videoError: string | null }> {
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
    callerVideo: null,
    callerCanvas: null,
    callerVideoPoll: null,
    agentVideo: null,
    teardown() {
      clearInterval(poll);
      clearInterval(b.callerVideoPoll);
      if (b.agent) {
        b.agent.source.disconnect();
        b.agent.keepAlive.srcObject = null;
        b.agent.consumer.close();
        b.agent = null;
      }
      if (b.agentVideo) {
        // The camera is black again from its next frame: the agent's video never reaches the next call.
        if (call.camera?.source === b.agentVideo.view) call.camera.source = null;
        b.agentVideo.view.srcObject = null;
        b.agentVideo.consumer.close();
        b.agentVideo = null;
      }
      // Closes "caller" and "callerVideo" too: stopTracks false leaves WhatsApp Web's own audio track running, and the
      // video's tracks, our captures, stop with it.
      try { b.send?.close(); } catch { /* already closed */ }
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
    let videoError: string | null = null;
    if (video) {
      // Black until the call view draws the caller (attachCallerVideoInPage). 800 kbps keeps a call near 1 Mbps each way.
      const placeholder = document.createElement('canvas');
      placeholder.width = 320;
      placeholder.height = 240;
      const g = placeholder.getContext('2d');
      g.fillRect(0, 0, 320, 240);
      try {
        b.callerVideo = await b.send.produce({ track: placeholder.captureStream(15).getVideoTracks()[0], encodings: [{ maxBitrate: 800000 }] });
        // A canvas capture sends a frame only when its canvas is drawn: painted once, an agent that consumes before the
        // attach (or after one that failed) would get no frame at all. Redrawn every second, it gets black within one.
        b.callerVideoPoll = setInterval(() => g.fillRect(0, 0, 320, 240), 1000);
      } catch (e) {
        videoError = String((e as Error)?.message ?? e);
      }
      if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    }
    let gone = 0;
    poll = setInterval(() => {
      try { gone = over() ? gone + 1 : 0; } catch { gone++; } // a call state that cannot be read is not a live call
      if (gone >= 2) {
        if (w.__mwBridge === b) delete w.__mwBridge;
        b.teardown();
      }
    }, 250);
    return { callerProducerId: b.caller.id, callerVideoProducerId: b.callerVideo?.id ?? null, videoError };
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
 * Swap "callerVideo" from its black placeholder to WhatsApp Web's own drawing of the caller. During a video call WhatsApp
 * Web draws the caller into a canvas of its call view (some 382×344, live): the largest canvas in the document. Ours are
 * never in the document, and one narrower than 160 or lower than 120 (an avatar, a sticker, a strip) is no video,
 * whatever its area. It waits up to 5 s for one ("No caller video"). Once attached, the capture follows the largest
 * canvas, looked for every second while the bridge lasts: WhatsApp Web may replace its canvas mid-call. Refused on a
 * voice bridge and when the call is not WhatsApp's active call, also when it ended during the wait. A failure leaves the
 * call's audio as it is, and "callerVideo" on its black placeholder. Resolves with the size of the canvas.
 */
export async function attachCallerVideoInPage(callId: string): Promise<{ width: number; height: number }> {
  const w = window as any;
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId) throw new Error('No media bridge for this call');
  if (!b.callerVideo) throw new Error('No video on this call');
  if (!ours()) throw new Error('Call is not the active call');
  const largest = (): HTMLCanvasElement | null => {
    let best: HTMLCanvasElement | null = null;
    for (const c of Array.from(document.querySelectorAll('canvas'))) {
      if (c.width >= 160 && c.height >= 120 && (!best || c.width * c.height > best.width * best.height)) best = c;
    }
    return best;
  };
  let canvas = largest();
  for (const end = Date.now() + 5000; !canvas && Date.now() < end; canvas = largest()) await new Promise((r) => setTimeout(r, 100));
  if (w.__mwBridge !== b) throw new Error('Media bridge closed');
  if (!ours()) throw new Error('Call is not the active call');
  if (!canvas) throw new Error('No caller video');
  // replaceTrack stops the capture it replaces (the producer's stopTracks): only ours, never WhatsApp Web's canvas.
  const capture = async (c: HTMLCanvasElement) => {
    await b.callerVideo.replaceTrack({ track: c.captureStream(15).getVideoTracks()[0] });
    b.callerCanvas = c;
  };
  await capture(canvas);
  if (w.__mwBridge !== b) throw new Error('Media bridge closed'); // torn down meanwhile: no poll may outlive the bridge
  clearInterval(b.callerVideoPoll); // the placeholder's redraw, or an earlier attach's poll
  b.callerVideoPoll = setInterval(() => {
    const now = largest();
    if (now && now !== b.callerCanvas) capture(now).catch(() => {});
  }, 1000);
  return { width: canvas.width, height: canvas.height };
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

/**
 * Draw the agent's video producer into the injected camera (`__mwCall.camera`), the one WhatsApp Web sends to the
 * caller: a <video> outside the document plays it, and the camera's canvas draws that. One agent video at a time.
 * Refused on a voice bridge, and when the call is not WhatsApp's active call, before and after every wait; a connect
 * that fails after the room created its consumer undoes all of it (the camera black, the consumer closed on both sides)
 * and rejects, so a retry starts clean. It never touches the call's audio.
 */
export async function connectAgentVideoInPage(callId: string, producerId: string): Promise<void> {
  const w = window as any;
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId || !b.recv) throw new Error('No media bridge for this call');
  if (!b.callerVideo) throw new Error('No video on this call');
  if (b.agentVideo) throw new Error('Agent video already connected');
  if (!ours()) throw new Error('Call is not the active call');
  const camera = w.__mwCall.ensureCamera(); // before the consume: from there on, any failure is undone below
  const signal = async (op: string, args: unknown) => JSON.parse(await w.__mwBridgeSignal(callId, op, JSON.stringify(args)));
  const options = await signal('consume', { transportId: b.recv.id, producerId, rtpCapabilities: b.device.rtpCapabilities });
  const live = () => {
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    if (!ours()) throw new Error('Call is not the active call');
  };
  let consumer: any;
  let view: HTMLVideoElement | undefined;
  let mine: MwBridge['agentVideo'] = null;
  try {
    live();
    consumer = await b.recv.consume(options);
    live();
    if (b.agentVideo) throw new Error('Agent video already connected');
    // Marked as ours BEFORE its srcObject is set, like every stream of ours: tap A looks at every srcObject.
    const stream = new MediaStream([consumer.track]);
    (stream as any).__mwOwn = true;
    view = document.createElement('video');
    view.muted = true;
    view.srcObject = stream;
    view.play().catch(() => {});
    b.agentVideo = mine = { consumer, view };
    camera.source = view;
    await signal('resumeConsumer', { consumerId: consumer.id });
    live();
  } catch (e) {
    if (view && camera.source === view) camera.source = null;
    if (view) view.srcObject = null;
    consumer?.close();
    if (mine && b.agentVideo === mine) b.agentVideo = null;
    try {
      await w.__mwBridgeSignal(callId, 'closeConsumer', JSON.stringify({ consumerId: options.id }));
    } catch { /* best effort: the room closes its consumers with the room */ }
    throw e;
  }
}

/** Take the agent's video off the injected camera, black again from its next frame. Does nothing when none is connected. */
export async function disconnectAgentVideoInPage(callId: string): Promise<void> {
  const w = window as any;
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId) throw new Error('No media bridge for this call');
  const a = b.agentVideo;
  if (!a) return;
  b.agentVideo = null;
  const camera = w.__mwCall.camera;
  if (camera?.source === a.view) camera.source = null;
  a.view.srcObject = null;
  a.consumer.close();
  await w.__mwBridgeSignal(callId, 'closeConsumer', JSON.stringify({ consumerId: a.consumer.id })).catch(() => undefined);
}

/**
 * Turn the camera WhatsApp Web sends to the caller off (`muted`) or on, with WhatsApp Web's own video mute: what it then
 * sends is the injected camera, black unless the agent's video is connected (connectAgentVideoInPage). Within
 * `timeoutMs`, as hangUpActiveCall: a voip stack that never answers must not hold the next switch until puppeteer's
 * protocol timeout. setCallVideoMute is never STARTED after the deadline, nor once the bridge closed, but one already
 * started cannot be cancelled: it may still switch the camera after this rejected. Refused on a voice bridge and for a
 * call that is not WhatsApp's active call.
 */
export async function setCameraMutedInPage(callId: string, muted: boolean, timeoutMs: number): Promise<void> {
  const w = window as any;
  const ours = () => {
    const c = w.require('WAWebCallCollection').activeCall;
    return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId);
  };
  const b: MwBridge | undefined = w.__mwBridge;
  if (!b || b.callId !== callId) throw new Error('No media bridge for this call');
  if (!b.callerVideo) throw new Error('No video on this call');
  if (!ours()) throw new Error('Call is not the active call');
  const deadline = Date.now() + timeoutMs;
  const timedOut = () => new Error('The camera did not switch in time');
  let timer: any;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timedOut()), timeoutMs); });
  try {
    const stack = await Promise.race([w.require('WAWebVoipStackInterface').getVoipStackInterface(), expired]);
    if (Date.now() > deadline) throw timedOut(); // a busy page runs timers late: the clock has the last word
    if (w.__mwBridge !== b) throw new Error('Media bridge closed');
    if (!ours()) throw new Error('Call is not the active call');
    if (typeof stack.setCallVideoMute !== 'function') throw new Error('WhatsApp Web has no camera mute');
    await Promise.race([stack.setCallVideoMute(muted), expired]);
  } finally {
    clearTimeout(timer);
  }
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

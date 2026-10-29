// MultiWA Gateway - call media inside the WhatsApp Web page
// packages/engines/src/adapters/webjs-call-media/page.ts
//
// Every function runs INSIDE the browser page (page.evaluate / evaluateOnNewDocument), so each one is
// self-contained: no imports, no closures over module scope. That is why each per-call function repeats the same
// one-line call-id guard. The engines target (ES2021) keeps them free of TypeScript helpers (a downlevel helper
// would not exist in the page): the browser spec runs the page functions stringified, as puppeteer sends them, and
// the unit spec checks the init script. The interfaces below are types only, erased at compile time.
//
// The recipes are WhatsApp Web's own: the Accept and End buttons
// (useWAWebVoipCallHandlers) and its playback routes (WAWebVoipAudioPlayback*). Proven live in spike B and
// Milestone 0 (2026-10-29: macOS Chrome, Linux Chromium 156, and the wagw api image). See findings.md.

/** A stream WhatsApp Web plays: a candidate for the caller's voice. */
export interface MwTap {
  stream: MediaStream;
  /**
   * - `element` (tap A): set as an `<audio>`'s srcObject; in use while that element still holds it.
   * - `destination` (tap B): a copy of what one context connects to its AudioDestinationNode; in use until that
   *   context is closed. Chrome keeps the track of a closed context's MediaStreamAudioDestinationNode `live` and
   *   fires no `ended`, so only the owner tells a dead tap from a live one.
   */
  via: 'element' | 'destination';
  /** The element (A) or the AudioContext (B) whose use keeps the tap in use. */
  owner: HTMLMediaElement | AudioContext;
  /**
   * Note order (`MwCall.noted`): every note takes the next number, so a re-noted tap counts as new. A is noted when
   * set as srcObject, B on EVERY connect to the destination, so a reused context is the newest again. An order, not
   * a time: a clock has ties and steps back.
   */
  seq: number;
}

/**
 * How callerTap chose its tap: the tripwire for a wrong pick. A normal call has exactly ONE fresh candidate, the
 * playback of the caller; anything else means the pick was a guess.
 */
export interface MwTapPick {
  /** The chosen tap was noted after the answer started (`seq > answeredAfter`). */
  fresh: boolean;
  /** In-use taps that are not ours and were noted after the answer, when the choice was made; more than one is ambiguous. */
  freshCandidates: number;
  /** No tap of this call turned up within the wait: an older one that is still in use was taken. */
  fallback: boolean;
}

/**
 * `window.__mwCall`, published by installCallMediaHooks once all its hooks are in place: the state the page
 * functions share, and the API PR 2's page peer builds on (it sends `await callerTap(5000)` to the agent and feeds
 * `inputs.agent`).
 *
 * Our own streams carry `__mwOwn`, so the taps skip them. Mark a stream BEFORE setting it as an element's
 * srcObject (PR 2: the muted keep-alive of the agent's track), or tap A takes it for the caller.
 */
export interface MwCall {
  /** Recent taps, oldest first. Every note drops the taps no longer in use and keeps the last 8. Read callerTap(). */
  taps: MwTap[];
  /** Taps noted so far on this document: the `seq` of the latest note. */
  noted: number;
  /**
   * The caller's voice: the newest in-use tap that is not ours, preferring one noted after the answer started
   * (`answeredAfter`). WhatsApp Web starts playing the caller right after `acceptCall`, before the call reads as
   * connected (live: the tap was noted about 40 ms after the accept), and `answeredAfter` is recorded before the
   * accept, so that tap counts as noted after the answer. This waits up to `waitMs` for such a tap, then takes the
   * newest in-use one; null when there is none. The recorder uses it, and so will PR 2's attachCaller. The tap
   * comes as a copy with how it was chosen (MwTapPick).
   */
  callerTap(waitMs: number): Promise<(MwTap & MwTapPick) | null>;
  /** `noted` when answerActiveCall last started an answer: the taps with a higher `seq` belong to the current call. */
  answeredAfter?: number;
  /** The injected microphone, created by ensure(): every audio-only getUserMedia gets a clone of `dest`'s track. */
  ctx: AudioContext | null;
  dest: MediaStreamAudioDestinationNode | null;
  /** Mixed into the microphone: the announcement, and the agent (PR 2), held silent while an announcement plays. */
  inputs: { announcement: GainNode; agent: GainNode } | null;
  /** Creates the microphone once, resumes its context, returns this. */
  ensure(): MwCall;
  /** getUserMedia calls answered with the injected microphone. */
  gumCalls: number;
  /** The page's own getUserMedia (prepareCallMediaPage). */
  realGetUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  /** prepareCallMediaPage got the microphone permission on this document. */
  prepared?: boolean;
  /** The one recorder; `done` settles once the last chunk went through the binding. */
  recorder: { callId: string; mr: MediaRecorder; startedAt: number; nodes: AudioNode[]; done: Promise<void> } | null;
  /** One announcement at a time. */
  announcing: boolean;
}

/**
 * Document-start hooks, on every WhatsApp Web document (evalOnNewDoc), so a WA Web self-reload keeps them:
 * - the injected microphone: every audio-only getUserMedia gets a clone of one Web Audio stream, fed by a
 *   silent source (a destination without input sends no frames at all), an announcement input and an agent
 *   input;
 * - taps on what WhatsApp Web plays: tap A for `<audio>.srcObject`, tap B for nodes connected to an
 *   AudioDestinationNode. That playback is the caller's voice.
 * `window.__mwCall` is published last, so a page whose hooks did not all install never probes as supported.
 */
export function installCallMediaHooks(): void {
  const w = window as any;
  if (w !== w.top || w.__mwCall || !navigator.mediaDevices) return;
  const md = navigator.mediaDevices;
  const inUse = (t: MwTap) =>
    t.stream.getAudioTracks().some((k) => k.readyState === 'live') &&
    (t.via === 'destination' ? (t.owner as AudioContext).state !== 'closed' : (t.owner as HTMLMediaElement).srcObject === t.stream);
  const call: MwCall = {
    taps: [],
    noted: 0,
    ctx: null,
    dest: null,
    inputs: null,
    gumCalls: 0,
    recorder: null,
    announcing: false,
    realGetUserMedia: md.getUserMedia.bind(md),
    async callerTap(waitMs: number) {
      const candidates = (after: number) => call.taps.filter((t) => t.seq > after && !(t.stream as any).__mwOwn && inUse(t));
      const end = Date.now() + waitMs;
      while (!candidates(call.answeredAfter ?? 0).length && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
      const after = call.answeredAfter ?? 0;
      const fresh = candidates(after);
      const tap = fresh[fresh.length - 1] ?? candidates(0).pop();
      if (!tap) return null;
      return { ...tap, fresh: tap.seq > after, freshCandidates: fresh.length, fallback: tap.seq <= after };
    },
    ensure() {
      if (!call.ctx) {
        const ctx = new AudioContext({ sampleRate: 48000 });
        const dest = ctx.createMediaStreamDestination();
        const hum = ctx.createConstantSource();
        hum.offset.value = 0;
        hum.connect(dest);
        hum.start();
        const announcement = ctx.createGain();
        const agent = ctx.createGain();
        announcement.connect(dest);
        agent.connect(dest);
        call.ctx = ctx;
        call.dest = dest;
        call.inputs = { announcement, agent };
      }
      if (call.ctx.state !== 'running') call.ctx.resume().catch(() => {});
      return call;
    },
  };
  const note = (stream: MediaStream, via: MwTap['via'], owner: MwTap['owner']) => {
    call.taps = call.taps.filter((t) => t.stream !== stream && inUse(t)).slice(-7); // with the new one: 8 at most
    call.taps.push({ stream, via, owner, seq: ++call.noted });
  };
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(v: any) {
      d.set.call(this, v);
      try { if (v instanceof MediaStream && !(v as any).__mwOwn && v.getAudioTracks().length) note(v, 'element', this); } catch {}
    },
  });
  const connect = AudioNode.prototype.connect;
  (AudioNode.prototype as any).connect = function (dest: any, ...rest: any[]) {
    const r = (connect as any).call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx: any = this.context;
        ctx.__mwTap ??= ctx.createMediaStreamDestination();
        (connect as any).call(this, ctx.__mwTap, rest[0] ?? 0); // the output the page connected
        note(ctx.__mwTap.stream, 'destination', ctx);
      }
    } catch {}
    return r;
  };
  // A node the page disconnects from the destination must leave our tap too, so the recording follows WhatsApp's
  // own muting. disconnect() and disconnect(output) already drop the tap's connection; a targeted one does not.
  const disconnect = AudioNode.prototype.disconnect;
  (AudioNode.prototype as any).disconnect = function (...args: any[]) {
    const r = (disconnect as any).apply(this, args);
    try {
      const tap = (this.context as any).__mwTap;
      if (tap && args[0] instanceof AudioDestinationNode) (disconnect as any).call(this, tap, ...args.slice(1));
    } catch {}
    return r;
  };
  const orig = call.realGetUserMedia;
  md.getUserMedia = function (c?: MediaStreamConstraints) {
    if (!c || !c.audio || c.video) return orig(c);
    call.ensure();
    call.gumCalls++;
    const s: any = new MediaStream([call.dest.stream.getAudioTracks()[0].clone()]);
    s.__mwOwn = true;
    return Promise.resolve(s);
  };
  w.__mwCall = call;
}

/** Per document, on every `ready`: one real getUserMedia on the FAKE device, so the origin's mic permission reads granted. */
export async function prepareCallMediaPage(): Promise<{ hooks: boolean; micPermission: string }> {
  const call: MwCall = (window as any).__mwCall;
  if (!call) return { hooks: false, micPermission: 'no hooks' };
  if (call.prepared) return { hooks: true, micPermission: 'already granted' };
  try {
    const s = await call.realGetUserMedia({ audio: true });
    s.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    call.prepared = true;
    return { hooks: true, micPermission: 'granted' };
  } catch (e) {
    return { hooks: true, micPermission: `failed: ${(e as Error).message}` };
  }
}

/**
 * Can this page carry a call: modules present, calling UI on, in-browser voip stack, our hooks. A voip stack
 * lookup that does not answer within `timeoutMs` counts as `voip_stack_unavailable`.
 */
export async function probeCallMedia(timeoutMs: number): Promise<{ reasons: string[]; waVersion: string | null }> {
  const w = window as any;
  const reasons: string[] = [];
  const req = (m: string) => { try { return w.require(m); } catch { return null; } };
  const needed = ['WAWebCallCollection', 'WAWebVoipCallStateUtils', 'WAWebVoipStackInterface', 'WAWebVoipSignalingEnums', 'WAWebCallRingtone', 'WAWebVoipCallAudioUnlock', 'WAWebVoipGatingUtils'];
  if (needed.some((m) => !req(m))) reasons.push('module_missing');
  try { if (req('WAWebVoipGatingUtils')?.isWebCallingUiEnabled() !== true) reasons.push('web_calling_disabled'); } catch { reasons.push('web_calling_disabled'); }
  let timer: any;
  try {
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('voip stack lookup timed out')), timeoutMs); });
    const stack = await Promise.race([req('WAWebVoipStackInterface')?.getVoipStackInterface(), expired]);
    if (!stack || stack.type !== 'web') reasons.push('voip_stack_unavailable');
  } catch {
    reasons.push('voip_stack_unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (!w.__mwCall) reasons.push('hooks_missing');
  return { reasons: [...new Set(reasons)], waVersion: w.Debug?.VERSION ?? null };
}

/**
 * Answer the ringing call `callId` (WhatsApp's active call) and wait until it is connected. ONE deadline,
 * `timeoutMs` after the answer starts, bounds all of it: the voip stack lookup, the accept itself (a stack that
 * never answers would otherwise hold this until puppeteer's protocol timeout) and the wait for the connected
 * state. acceptCall is never STARTED after the deadline, but one already started cannot be cancelled: the call may
 * still connect after this rejected, so the caller must then hang it up (see CallMediaEngine.answer).
 * Refused without our hooks: WhatsApp Web would put Chrome's fake microphone (a beep) on the call.
 */
export async function answerActiveCall(callId: string, timeoutMs: number): Promise<{ connectedAfterMs: number }> {
  const w = window as any;
  const call: MwCall = w.__mwCall;
  if (!call) throw new Error('Call media hooks missing');
  const CC = w.require('WAWebCallCollection');
  const U = w.require('WAWebVoipCallStateUtils');
  const ours = () => { const c = CC.activeCall; return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId); };
  if (!ours()) throw new Error('Call is not the active call');
  if (!U.isCallIncoming(CC.activeCall.getState())) throw new Error('Call is not ringing');
  try { w.require('WAWebCallRingtone').stopCallRingtone(); } catch {}
  try { w.require('WAWebVoipCallAudioUnlock').prepareCallAudioElement(); } catch {}
  call.ensure();
  call.answeredAfter = call.noted; // this call's playback is noted from now on (callerTap)
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  const timedOut = () => new Error('Call did not connect in time');
  let timer: any;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timedOut()), timeoutMs); });
  try {
    const stack = await Promise.race([w.require('WAWebVoipStackInterface').getVoipStackInterface(), expired]);
    if (Date.now() > deadline) throw timedOut(); // a busy page runs timers late: the clock has the last word
    if (!ours()) throw new Error('Call ended before it connected');
    await Promise.race([stack.acceptCall(true, false, null), expired]);
    for (;;) {
      if (!ours()) throw new Error('Call ended before it connected');
      if (U.isCallConnected(CC.activeCall.getState())) return { connectedAfterMs: Date.now() - t0 };
      if (Date.now() > deadline) throw timedOut();
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * End the call `callId` the way WhatsApp Web's End button does, within `timeoutMs`: a voip stack that never
 * answers must not hold the caller until puppeteer's protocol timeout. Nothing is touched before the stack is in
 * hand, and nothing is started after the deadline.
 */
export async function hangUpActiveCall(callId: string, timeoutMs: number): Promise<void> {
  const w = window as any;
  const CC = w.require('WAWebCallCollection');
  const ours = () => { const c = CC.activeCall; return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId); };
  if (!ours()) throw new Error('Call is not the active call');
  const deadline = Date.now() + timeoutMs;
  const timedOut = () => new Error('Call did not end in time');
  let timer: any;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timedOut()), timeoutMs); });
  try {
    const stack = await Promise.race([w.require('WAWebVoipStackInterface').getVoipStackInterface(), expired]);
    if (Date.now() > deadline) throw timedOut();
    if (!ours()) throw new Error('Call is not the active call'); // it ended, or another call took its place, meanwhile
    CC.activeCall.userEndedCall = true;
    await Promise.race([stack.endCall(w.require('WAWebVoipSignalingEnums').EndCallReason.Self, true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Play an encoded audio file (base64) into the call's microphone; the agent input is silent until it ends.
 * One at a time: a second announcement would hand the line back to the agent while the first still plays, so
 * it is refused. The guard is set before the first await and released in `finally`, whatever happens. A
 * playback that has not ended 5 s after its own length (a suspended or torn-down context never reaches the
 * end) rejects, and the same `finally` stops it and gives the agent input back the gain it had.
 */
export async function playAnnouncementInPage(callId: string, b64: string): Promise<{ durationMs: number }> {
  const w = window as any;
  const c = w.require('WAWebCallCollection').activeCall;
  if (!c || String(c.id) !== callId || (w._multiwaCallId && w._multiwaCallId !== callId)) throw new Error('Call is not the active call');
  const call: MwCall = w.__mwCall.ensure();
  if (call.announcing) throw new Error('Announcement already playing');
  call.announcing = true;
  try {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const buf = await call.ctx.decodeAudioData(bytes.buffer);
    const src = call.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(call.inputs.announcement);
    const agentGain = call.inputs.agent.gain.value; // the agent may be held silent already: give back what it had
    call.inputs.agent.gain.value = 0;
    let watchdog: any;
    try {
      await new Promise<void>((resolve, reject) => {
        src.onended = () => resolve();
        src.start();
        // a context that never reaches the end of the buffer (suspended, torn down) must not hold the line for good
        watchdog = setTimeout(() => reject(new Error('Announcement did not finish')), buf.duration * 1000 + 5000);
      });
    } finally {
      clearTimeout(watchdog);
      try { src.stop(); } catch {} // after the watchdog: it would play on once the context runs again
      src.disconnect();
      call.inputs.agent.gain.value = agentGain;
    }
    return { durationMs: Math.round(buf.duration * 1000) };
  } finally {
    call.announcing = false;
  }
}

/**
 * Record the call `callId`: left = the caller (callerTap), right = what the caller hears (the injected
 * microphone). WebM/Opus chunks, in order, go to the page binding `__mwRecordingChunk`. One recorder at a time,
 * also for starts that overlap while they wait for a caller tap. The call-id guard runs again after that wait: a
 * call that ended meanwhile is refused, not recorded on whatever tap was left. A chunk the binding fails to take is
 * counted and skipped; the later ones are still delivered, and stopRecordingInPage reports the loss.
 * Resolves with how the caller's tap was chosen (MwTapPick, see callerTap): the wrapper warns when it was a guess.
 */
export async function startRecordingInPage(callId: string, timesliceMs: number): Promise<{ callerVia: string } & MwTapPick> {
  const w = window as any;
  const ours = () => { const c = w.require('WAWebCallCollection').activeCall; return !!c && String(c.id) === callId && (!w._multiwaCallId || w._multiwaCallId === callId); };
  if (!ours()) throw new Error('Call is not the active call');
  if (typeof w.__mwRecordingChunk !== 'function') throw new Error('Recording binding missing');
  const call: MwCall = w.__mwCall.ensure();
  if (call.recorder) throw new Error('Already recording');
  const tap = await call.callerTap(5000);
  if (!ours()) throw new Error('Call is not the active call'); // it ended, or another call took its place, during the wait
  if (!tap) throw new Error('No caller audio to record');
  // The recorder is claimed below, synchronously; another start may have claimed it while this one waited for a tap.
  if (call.recorder) throw new Error('Already recording');
  const ctx = call.ctx;
  const caller = ctx.createMediaStreamSource(tap.stream);
  const heard = ctx.createMediaStreamSource(call.dest.stream);
  const merger = ctx.createChannelMerger(2);
  const out = ctx.createMediaStreamDestination();
  out.channelCount = 2;
  const nodes: AudioNode[] = [caller, heard, merger, out];
  let chunks = 0;
  let failedChunks = 0;
  let failed: any = null;
  let queue = Promise.resolve();
  let mr: MediaRecorder;
  let stopped: Promise<void>;
  try {
    mr = new MediaRecorder(out.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
    stopped = new Promise<void>((resolve) => { mr.onstop = () => resolve(); });
    mr.ondataavailable = (e: BlobEvent) => {
      if (!e.data.size) return;
      chunks++;
      queue = queue
        .then(async () => {
          const u8 = new Uint8Array(await e.data.arrayBuffer());
          let bin = '';
          for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          await w.__mwRecordingChunk(btoa(bin));
        })
        .catch((err) => { failed ??= err; failedChunks++; });
    };
    caller.connect(merger, 0, 0);
    heard.connect(merger, 0, 1);
    merger.connect(out);
    mr.start(timesliceMs);
  } catch (e) {
    nodes.forEach((n) => n.disconnect());
    throw e;
  }
  const done = stopped.then(() => queue).then(() => {
    if (failedChunks) throw new Error(`${failedChunks} of ${chunks} recording chunks were not delivered: ${failed?.message ?? failed}`);
  });
  done.catch(() => {}); // stopRecordingInPage reports it; a recorder that stops by itself must not log an unhandled rejection
  call.recorder = { callId, mr, startedAt: Date.now(), nodes, done };
  return { callerVia: tap.via, fresh: tap.fresh, freshCandidates: tap.freshCandidates, fallback: tap.fallback };
}

/**
 * Stop the recording of `callId`; resolves once the last chunk went through the binding. Rejects when chunks were
 * lost (the message says how many of how many), but the recorder is cleared all the same: otherwise every later
 * start would fail with "Already recording" until the page reloads. No active-call guard: a recording must stop
 * after its call ended.
 */
export async function stopRecordingInPage(callId: string): Promise<{ durationMs: number }> {
  const call: MwCall = (window as any).__mwCall;
  const rec = call?.recorder;
  if (!rec) throw new Error('Not recording');
  if (rec.callId !== callId) throw new Error('Not recording this call');
  rec.mr.stop();
  try {
    await rec.done;
  } finally {
    rec.nodes.forEach((n: AudioNode) => n.disconnect());
    if (call.recorder === rec) call.recorder = null;
  }
  return { durationMs: Date.now() - rec.startedAt };
}

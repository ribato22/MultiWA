// MultiWA Gateway - call media inside the WhatsApp Web page
// packages/engines/src/adapters/webjs-call-media/page.ts
//
// Every export runs INSIDE the browser page (page.evaluate / evaluateOnNewDocument), so each one is
// self-contained: no imports, no closures over module scope. The engines target (ES2021) keeps them free
// of TypeScript helpers; webjs-call-media.spec.ts asserts that.
//
// The recipes are WhatsApp Web's own: the Accept and End buttons
// (useWAWebVoipCallHandlers) and its playback routes (WAWebVoipAudioPlayback*). Proven live in spike B and
// Milestone 0 (2026-10-29: macOS Chrome, Linux Chromium 156, and the wagw api image). See findings.md.

/**
 * Document-start hooks, on every WhatsApp Web document (evalOnNewDoc), so a WA Web self-reload keeps them:
 * - the injected microphone: every audio-only getUserMedia gets a clone of one Web Audio stream, fed by a
 *   silent source (a destination without input sends no frames at all), an announcement input and an agent
 *   input;
 * - taps on what WhatsApp Web plays: tap A for `<audio>.srcObject`, tap B for nodes connected to an
 *   AudioDestinationNode. That playback is the caller's voice.
 *
 * Our own streams carry `__mwOwn`, so the taps ignore them.
 */
export function installCallMediaHooks(): void {
  const w = window as any;
  if (w !== w.top || w.__mwCall || !navigator.mediaDevices) return;
  const call: any = (w.__mwCall = { taps: [], ctx: null, dest: null, inputs: null, gumCalls: 0, recorder: null, announcing: false });
  const note = (stream: MediaStream, via: string) => {
    if (!call.taps.some((t: any) => t.stream === stream)) call.taps.push({ stream, via, at: Date.now() });
  };
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    enumerable: d.enumerable,
    get: d.get,
    set(v: any) {
      try { if (v instanceof MediaStream && !(v as any).__mwOwn && v.getAudioTracks().length) note(v, 'element'); } catch {}
      d.set.call(this, v);
    },
  });
  const connect = AudioNode.prototype.connect;
  (AudioNode.prototype as any).connect = function (dest: any, ...rest: any[]) {
    const r = (connect as any).call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        const ctx: any = this.context;
        if (!ctx.__mwTap) { ctx.__mwTap = ctx.createMediaStreamDestination(); note(ctx.__mwTap.stream, 'destination'); }
        (connect as any).call(this, ctx.__mwTap);
      }
    } catch {}
    return r;
  };
  call.ensure = () => {
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
  };
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  call.realGetUserMedia = orig;
  md.getUserMedia = function (c?: MediaStreamConstraints) {
    if (!c || !c.audio || c.video) return orig(c);
    call.ensure();
    call.gumCalls++;
    const s: any = new MediaStream([call.dest.stream.getAudioTracks()[0].clone()]);
    s.__mwOwn = true;
    return Promise.resolve(s);
  };
}

/** Per document, on every `ready`: one real getUserMedia on the FAKE device, so the origin's mic permission reads granted. */
export async function prepareCallMediaPage(): Promise<{ hooks: boolean; micPermission: string }> {
  const call = (window as any).__mwCall;
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

/** Can this page carry a call: modules present, calling UI on, in-browser voip stack. */
export async function probeCallMedia(): Promise<{ reasons: string[]; waVersion: string | null }> {
  const w = window as any;
  const reasons: string[] = [];
  const req = (m: string) => { try { return w.require(m); } catch { return null; } };
  const needed = ['WAWebCallCollection', 'WAWebVoipCallStateUtils', 'WAWebVoipStackInterface', 'WAWebVoipSignalingEnums', 'WAWebCallRingtone', 'WAWebVoipCallAudioUnlock', 'WAWebVoipGatingUtils'];
  if (needed.some((m) => !req(m))) reasons.push('module_missing');
  try { if (req('WAWebVoipGatingUtils')?.isWebCallingUiEnabled() !== true) reasons.push('web_calling_disabled'); } catch { reasons.push('web_calling_disabled'); }
  try {
    const stack = await req('WAWebVoipStackInterface')?.getVoipStackInterface();
    if (!stack || stack.type !== 'web') reasons.push('voip_stack_unavailable');
  } catch { reasons.push('voip_stack_unavailable'); }
  if (!w.__mwCall) reasons.push('module_missing');
  return { reasons: [...new Set(reasons)], waVersion: w.Debug?.VERSION ?? null };
}

/**
 * Answer the ringing call `callId` (WhatsApp's active call) and wait until it is connected. ONE deadline,
 * `timeoutMs` after the answer starts, bounds all of it: the voip stack lookup, the accept itself (a stack that
 * never answers would otherwise hold this until puppeteer's protocol timeout) and the wait for the connected
 * state. acceptCall is never called after the deadline: the answer is reported as failed, so the call must not
 * end up accepted anyway.
 */
export async function answerActiveCall(callId: string, timeoutMs: number): Promise<{ connectedAfterMs: number }> {
  const w = window as any;
  const CC = w.require('WAWebCallCollection');
  const U = w.require('WAWebVoipCallStateUtils');
  const c = CC.activeCall;
  if (!c || String(c.id) !== callId || (w._multiwaCallId && w._multiwaCallId !== callId)) throw new Error('Call is not the active call');
  if (!U.isCallIncoming(c.getState())) throw new Error('Call is not ringing');
  try { w.require('WAWebCallRingtone').stopCallRingtone(); } catch {}
  try { w.require('WAWebVoipCallAudioUnlock').prepareCallAudioElement(); } catch {}
  w.__mwCall?.ensure();
  const t0 = Date.now();
  const deadline = t0 + timeoutMs;
  const timedOut = () => new Error('Call did not connect in time');
  let timer: any;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timedOut()), timeoutMs); });
  try {
    const stack = await Promise.race([w.require('WAWebVoipStackInterface').getVoipStackInterface(), expired]);
    if (Date.now() > deadline) throw timedOut(); // a busy page runs timers late: the clock has the last word
    await Promise.race([stack.acceptCall(true, false, null), expired]);
    for (;;) {
      const a = CC.activeCall;
      if (!a || String(a.id) !== callId) throw new Error('Call ended before it connected');
      if (U.isCallConnected(a.getState())) return { connectedAfterMs: Date.now() - t0 };
      if (Date.now() > deadline) throw timedOut();
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    clearTimeout(timer);
  }
}

/** End the call `callId` the way WhatsApp Web's End button does. */
export async function hangUpActiveCall(callId: string): Promise<void> {
  const w = window as any;
  const c = w.require('WAWebCallCollection').activeCall;
  if (!c || String(c.id) !== callId) throw new Error('Call is not the active call');
  c.userEndedCall = true;
  const stack = await w.require('WAWebVoipStackInterface').getVoipStackInterface();
  await stack.endCall(w.require('WAWebVoipSignalingEnums').EndCallReason.Self, true);
}

/** True when `callId` is WhatsApp's active call (guard for the media calls below). */
export function isActiveCall(callId: string): boolean {
  const c = (window as any).require('WAWebCallCollection').activeCall;
  return !!c && String(c.id) === callId;
}

/**
 * Play an encoded audio file (base64) into the call's microphone; the agent input is silent until it ends.
 * One at a time: a second announcement would hand the line back to the agent while the first still plays, so
 * it is refused. The guard is set before the first await and released in `finally`, whatever happens. A
 * playback that has not ended 5 s after its own length (a suspended or torn-down context never reaches the
 * end) rejects, and the same `finally` gives the line back to the agent.
 */
export async function playAnnouncementInPage(b64: string): Promise<{ durationMs: number }> {
  const call = (window as any).__mwCall.ensure();
  if (call.announcing) throw new Error('Announcement already playing');
  call.announcing = true;
  try {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const buf = await call.ctx.decodeAudioData(bytes.buffer);
    const src = call.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(call.inputs.announcement);
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
      call.inputs.agent.gain.value = 1;
      src.disconnect();
    }
    return { durationMs: Math.round(buf.duration * 1000) };
  } finally {
    call.announcing = false;
  }
}

/**
 * Record the call: left = the caller (the newest live tap that is not ours), right = what the caller hears
 * (the injected microphone). WebM/Opus chunks, in order, go to the page binding `__mwRecordingChunk`. One
 * recorder at a time, also for starts that overlap while they wait for a caller tap.
 */
export async function startRecordingInPage(timesliceMs: number): Promise<{ callerVia: string }> {
  const call = (window as any).__mwCall.ensure();
  if (call.recorder) throw new Error('Already recording');
  let tap: any = null;
  for (let i = 0; i < 50 && !tap; i++) {
    tap = call.taps.filter((t: any) => !t.stream.__mwOwn && t.stream.getAudioTracks().some((k: MediaStreamTrack) => k.readyState === 'live')).pop() ?? null;
    if (!tap) await new Promise((r) => setTimeout(r, 100));
  }
  if (!tap) throw new Error('No caller audio to record');
  // The recorder is claimed below, synchronously; another start may have claimed it while this one waited for a tap.
  if (call.recorder) throw new Error('Already recording');
  const ctx = call.ctx;
  const merger = ctx.createChannelMerger(2);
  const caller = ctx.createMediaStreamSource(tap.stream);
  const heard = ctx.createMediaStreamSource(call.dest.stream);
  caller.connect(merger, 0, 0);
  heard.connect(merger, 0, 1);
  const out = ctx.createMediaStreamDestination();
  out.channelCount = 2;
  merger.connect(out);
  const mr = new MediaRecorder(out.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
  let queue = Promise.resolve();
  mr.ondataavailable = (e: BlobEvent) => {
    if (!e.data.size) return;
    queue = queue.then(async () => {
      const u8 = new Uint8Array(await e.data.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      await (window as any).__mwRecordingChunk(btoa(bin));
    });
  };
  const stopped = new Promise<void>((resolve) => { mr.onstop = () => resolve(); });
  call.recorder = { mr, startedAt: Date.now(), nodes: [merger, caller, heard], done: stopped.then(() => queue) };
  mr.start(timesliceMs);
  return { callerVia: tap.via };
}

/**
 * Stop recording; resolves once the last chunk went through the binding. If a chunk delivery failed this
 * rejects, but the recorder is cleared all the same: otherwise every later start would fail with
 * "Already recording" until the page reloads.
 */
export async function stopRecordingInPage(): Promise<{ durationMs: number }> {
  const call = (window as any).__mwCall;
  const rec = call?.recorder;
  if (!rec) throw new Error('Not recording');
  rec.mr.stop();
  try {
    await rec.done;
  } finally {
    rec.nodes.forEach((n: AudioNode) => n.disconnect());
    call.recorder = null;
  }
  return { durationMs: Date.now() - rec.startedAt };
}

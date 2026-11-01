// MultiWA Gateway - call media for the whatsapp-web.js engine (Node side)
// packages/engines/src/adapters/webjs-call-media/index.ts
//
// Thin wrapper: every method runs one function of ./page (the media bridge: ./bridge-page) inside the profile's
// WhatsApp Web page, and those functions check the call id themselves. The wrapper keeps only a little bookkeeping:
// the recording slot (which sink gets the chunks, and the start in progress, so a stop can wait for it), the
// recording binding per page, the media bridge slot, and the last probe and setup problem it logged (a problem that
// stays is logged once). Only used when EngineConfig.callMedia.enabled (the server switch CALLS_MEDIA_ENABLED).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallMediaEngine, CallMediaHandle, CallMediaSignaling, CallMediaSupport, CallMediaUnsupportedReason } from '../../types';
import {
  attachCallerInPage,
  closeBridgeInPage,
  connectAgentInPage,
  disconnectAgentInPage,
  hasMediasoupClient,
  startBridgeInPage,
} from './bridge-page';
import {
  installCallMediaHooks,
  prepareCallMediaPage,
  probeCallMedia,
  answerActiveCall,
  hangUpActiveCall,
  playAnnouncementInPage,
  startRecordingInPage,
  stopRecordingInPage,
} from './page';

/** The in-page functions, under a namespace: they only work inside the page (page.evaluate), never in Node. */
export * as callMediaPage from './page';

/** The media bridge's in-page functions, under a namespace: they only work inside the page (page.evaluate). */
export * as callMediaBridge from './bridge-page';

/**
 * Run one operation of the media signalling protocol on a room's signalling: the page bridge's binding uses it, and so
 * does the agent's `call:media` socket command. Unknown operations are refused; the room checks everything else.
 */
export async function runCallMediaSignal(s: CallMediaSignaling, op: string, a: any): Promise<unknown> {
  switch (op) {
    case 'rtpCapabilities': return s.rtpCapabilities();
    case 'createTransport': return s.createTransport(a?.direction);
    case 'connectTransport': return s.connectTransport(a?.transportId, a?.dtlsParameters);
    case 'produce': return s.produce(a?.transportId, a?.kind, a?.rtpParameters);
    case 'consume': return s.consume(a?.transportId, a?.producerId, a?.rtpCapabilities);
    case 'resumeConsumer': return s.resumeConsumer(a?.consumerId);
    case 'closeConsumer': return s.closeConsumer(a?.consumerId);
    default: throw new Error('Unknown media signalling operation');
  }
}

/**
 * Chrome flags for call media:
 * - fake devices, so the engine never opens a real microphone or camera (containers have none anyway);
 * - auto-accept of the media prompt;
 * - audio that may start without a gesture;
 * - muted output (the server has no speakers).
 */
export const CALL_MEDIA_CHROME_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];

/**
 * The hook installer as ONE script string: the exact source production passes as `evalOnNewDoc` is the source both
 * specs check and inject. (A function would work too and would also reach every new document, reloads included:
 * puppeteer's `evaluateOnNewDocument` builds `(fn)()` from it. whatsapp-web.js types `evalOnNewDoc` as `Function`
 * but forwards it to puppeteer, which takes a string as well.)
 */
export const CALL_MEDIA_INIT_SCRIPT = `(${installCallMediaHooks.toString()})();`;

let mediasoupClientSource: string | null = null;
/**
 * The mediasoup-client browser bundle: one script that defines `mediasoupClient` (built by
 * scripts/bundle-mediasoup-client.mjs at package build). The media bridge evaluates it into the page; read once.
 */
export function mediasoupClientBundle(): string {
  return (mediasoupClientSource ??= readFileSync(join(__dirname, 'mediasoup-client.iife.js'), 'utf8'));
}

const DEFAULT_ANSWER_TIMEOUT_MS = 15_000;
const HANG_UP_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const RECORDING_TIMESLICE_MS = 5_000;
/** The page's own scripts can call the bridge binding: real mediasoup messages are a few KB. */
const MAX_SIGNAL_JSON = 64 * 1024;
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'web_calling_disabled', 'voip_stack_unavailable', 'module_missing', 'hooks_missing', 'not_prepared',
]);
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');
/**
 * A binding's error as the page sees it. puppeteer forwards `error.stack` into the page, and a Node stack names the
 * server's files: a fresh Error whose stack is its message says only what went wrong.
 */
const forPage = (e: unknown): Error => {
  const error = new Error(String((e as Error)?.message ?? e));
  error.stack = error.message;
  return error;
};

/**
 * One wrapper per page (the adapter makes one per client): the binding name is fixed and "already exists" counts as
 * ours, so a second wrapper's chunks would reach the first one's slot.
 */
export class WebJsCallMedia implements CallMediaEngine {
  /**
   * The recording binding per page object, as the PENDING attempt: concurrent callers share one
   * `exposeFunction` instead of binding twice. puppeteer takes the name BEFORE it awaits anything, so a failed
   * attempt still leaves the name taken on that page object. Calling `exposeFunction` there again only throws
   * "already exists" (a retry helps only on a new page object, i.e. after a relaunch), and that error means
   * puppeteer still holds OUR binding: the page counts as bound. Any other failure drops the entry, so the
   * next call looks again.
   */
  private readonly bindings = new WeakMap<object, Promise<void>>();
  /**
   * The recording in progress and its sink. The binding delivers the chunks of `callId` to `onChunk`, and no others.
   * `started` settles when the start does (bound, and the in-page recorder running, or failed): a stop waits for it.
   */
  private recording: { callId: string; onChunk: (chunk: Buffer) => void; started: Promise<void> } | null = null;
  /**
   * The media bridge in progress (startCallMedia) and its room's signalling: the bridge binding serves only this. Held
   * from the start until close() or closeCallMedia(): the page ends its own bridge when its call is over, but the slot
   * is the coordinator's to free.
   */
  private bridge: { callId: string; signaling: CallMediaSignaling } | null = null;
  /** The bridge binding per page object, like `bindings` for the recording one. */
  private readonly bridgeBindings = new WeakMap<object, Promise<void>>();
  /** The probe error logged last: a probe that keeps failing the same way logs once. */
  private probeError: string | null = null;
  /** The setup problem warned about last: ready repeats 5-12 times per sync, so a problem that stays warns once. */
  private setupWarning: string | null = null;

  /** @param page returns the current puppeteer Page (it changes when the engine relaunches) */
  constructor(
    private readonly page: () => any,
    private readonly isReady: () => boolean,
    private readonly profileId: string,
  ) {}

  /** Per document, on every `ready`: user activation, the mic permission, and the recording binding. */
  async preparePage(): Promise<void> {
    const page = this.page();
    if (!page) return;
    // The binding never blocks the rest: user activation and the mic permission are needed for every call.
    await this.bindRecording(page).catch((e: any) => {
      console.warn(`[WhatsApp-WebJS] call media recording binding for profile ${clean(this.profileId)}: ${clean(e?.message ?? e)}`);
    });
    await page.keyboard.press('Shift').catch(() => undefined); // a trusted key press = user activation
    const r = await page.evaluate(prepareCallMediaPage);
    if (r.hooks && /^(granted|already granted)$/.test(r.micPermission)) {
      this.setupWarning = null; // a good setup re-arms the warning
      return;
    }
    const msg = clean(JSON.stringify(r));
    if (msg !== this.setupWarning) {
      console.warn(`[WhatsApp-WebJS] call media page setup for profile ${clean(this.profileId)}: ${msg}`);
    }
    this.setupWarning = msg;
  }

  async getSupport(): Promise<CallMediaSupport> {
    const page = this.page();
    if (!page || !this.isReady()) return { supported: false, reasons: ['not_ready'] };
    try {
      const r = await page.evaluate(probeCallMedia, PROBE_TIMEOUT_MS);
      this.probeError = null;
      // fail closed: a reason this side does not know must never read as supported
      const reasons = [...new Set<string>(r.reasons.map((x: string) => (KNOWN_REASONS.has(x) ? x : 'page_error')))] as CallMediaUnsupportedReason[];
      return { supported: reasons.length === 0, reasons, waVersion: r.waVersion };
    } catch (e) {
      const msg = clean((e as Error)?.message ?? String(e));
      if (msg !== this.probeError) console.warn(`[WhatsApp-WebJS] call media probe for profile ${clean(this.profileId)} failed: ${msg}`);
      this.probeError = msg;
      return { supported: false, reasons: ['page_error'] };
    }
  }

  async answer(callId: string, opts?: { timeoutMs?: number }): Promise<{ connectedAfterMs: number }> {
    const r = await this.requirePage().evaluate(answerActiveCall, callId, opts?.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS);
    console.log(`[WhatsApp-WebJS] Call ${clean(callId)} answered for profile ${clean(this.profileId)}, connected after ${r.connectedAfterMs} ms`);
    return r;
  }

  async hangUp(callId: string): Promise<void> {
    await this.requirePage().evaluate(hangUpActiveCall, callId, HANG_UP_TIMEOUT_MS);
  }

  async playAnnouncement(callId: string, audio: Buffer, opts: { maxDurationMs?: number } = {}): Promise<{ durationMs: number }> {
    return this.requirePage().evaluate(playAnnouncementInPage, callId, audio.toString('base64'), opts.maxDurationMs ?? null);
  }

  /**
   * Takes the recording slot before the first await, with the start itself on it (`started`), and frees the slot
   * only when this start fails. Warns once when the caller's tap was a guess (more than one fresh candidate, or the
   * fallback to an older tap): the recording's left channel may then not be the caller. No audio is logged.
   */
  async startRecording(callId: string, onChunk: (chunk: Buffer) => void): Promise<void> {
    const page = this.requirePage();
    if (this.recording) throw new Error('Already recording');
    const started = (async () => {
      await this.bindRecording(page);
      const r: Awaited<ReturnType<typeof startRecordingInPage>> = await page.evaluate(startRecordingInPage, callId, RECORDING_TIMESLICE_MS);
      if (r.freshCandidates > 1 || r.fallback) {
        console.warn(
          `[WhatsApp-WebJS] Call ${clean(callId)} for profile ${clean(this.profileId)}: the caller audio tap is a guess ` +
            `(${clean(r.freshCandidates)} fresh candidates, older tap used: ${clean(r.fallback)}, via ${clean(r.callerVia)}); ` +
            `the recording's left channel may not be the caller`,
        );
      }
    })();
    const slot = { callId, onChunk, started }; // no await between the start above and this line
    this.recording = slot;
    try {
      await started;
    } catch (e) {
      if (this.recording === slot) this.recording = null;
      throw e;
    }
  }

  /**
   * A stop never overtakes its own start: it waits for the start to settle, because the in-page recorder exists only
   * once the start succeeded (after a failed start it is a plain "Not recording"). It needs a page but no WhatsApp
   * readiness: after a `disconnected` event the page can still hold our recorder. Frees the slot whatever happens, so
   * a failed stop never blocks the next recording.
   */
  async stopRecording(callId: string): Promise<{ durationMs: number }> {
    const slot = this.recording;
    if (slot && slot.callId !== callId) throw new Error('Not recording this call');
    try {
      await slot?.started.catch(() => undefined);
      const page = this.page();
      if (!page) throw new Error('Client not ready');
      return await page.evaluate(stopRecordingInPage, callId);
    } finally {
      if (this.recording === slot) this.recording = null;
    }
  }

  /**
   * Takes the bridge slot before the first await. A start the coordinator stopped waiting for can still go on: once
   * closeCallMedia freed its slot, the late start does not start a page bridge (or closes the one it started) and
   * rejects, "Media bridge closed" or whatever its room or the page said first, instead of keeping the page; and the
   * page bridge it already started signals nothing more (bridge-page). The handle acts only while its slot is current,
   * so a stale one never drives a newer bridge of the same call. A failed start frees the slot only while it is still
   * its own, for the same reason.
   */
  async startCallMedia(callId: string, signaling: CallMediaSignaling): Promise<CallMediaHandle> {
    const page = this.requirePage();
    if (this.bridge) throw new Error('Media bridge already running');
    const slot = { callId, signaling };
    this.bridge = slot; // taken before the first await
    try {
      await this.bindBridge(page);
      if (!(await page.evaluate(hasMediasoupClient))) await page.evaluate(mediasoupClientBundle());
      if (this.bridge !== slot) throw new Error('Media bridge closed'); // given up on while the page loaded: the page is the retry's
      const { callerProducerId } = await page.evaluate(startBridgeInPage, callId);
      if (this.bridge !== slot) {
        await page.evaluate(closeBridgeInPage, callId).catch(() => undefined); // closeCallMedia ran while the page started
        throw new Error('Media bridge closed');
      }
      // The handle's operations run one at a time, in call order, per piece of page state: attachCaller touches the
      // caller (`b.caller`), connectAgent and disconnectAgent the agent (`b.agent`). A disconnect sent while a connect is
      // pending would find no agent yet, but it must not wait for a caller tap (up to 5 s) with the agent on the
      // microphone. A failure does not break a queue. Whether the bridge is still ours is checked when an operation's
      // turn comes. close() stays outside the queues: it must not wait behind a hung operation.
      const queue = () => {
        let chain: Promise<unknown> = Promise.resolve();
        return <T>(op: () => Promise<T>): Promise<T> => {
          const result = chain.then(() => {
            if (this.bridge !== slot) throw new Error('Media bridge closed');
            return op();
          });
          chain = result.catch(() => undefined);
          return result;
        };
      };
      const callerQueue = queue();
      const agentQueue = queue();
      return {
        callerProducerId,
        attachCaller: () => callerQueue(() => page.evaluate(attachCallerInPage, callId)),
        connectAgent: (producerId: string) => agentQueue(() => page.evaluate(connectAgentInPage, callId, producerId)),
        disconnectAgent: () => agentQueue(() => page.evaluate(disconnectAgentInPage, callId)),
        close: async () => {
          if (this.bridge !== slot) return;
          try {
            await page.evaluate(closeBridgeInPage, callId);
          } finally {
            if (this.bridge === slot) this.bridge = null;
          }
        },
      };
    } catch (e) {
      // While the slot is not ours any more, the page's bridge of this call may be a newer start's: leave it alone.
      if (this.bridge === slot) {
        this.bridge = null;
        await page.evaluate(closeBridgeInPage, callId).catch(() => undefined);
      }
      throw e;
    }
  }

  /**
   * The coordinator's teardown, with no handle, so it also covers a start it gave up on. Frees the slot at once when
   * it belongs to `callId`, then closes the page's bridge of that call. It needs a page but no WhatsApp readiness
   * (after a `disconnected` event the page can still hold the bridge), never rejects, and is idempotent.
   */
  async closeCallMedia(callId: string): Promise<void> {
    if (this.bridge?.callId === callId) this.bridge = null;
    try {
      await this.page()?.evaluate(closeBridgeInPage, callId);
    } catch {
      // the page is gone or failing: the bridge goes with the document, and the slot is free already
    }
  }

  /** One bridge binding per page object; puppeteer keeps it across navigations. Same pattern as bindRecording. */
  private async bindBridge(page: any): Promise<void> {
    let bound = this.bridgeBindings.get(page);
    if (!bound) {
      bound = this.exposeBridge(page);
      this.bridgeBindings.set(page, bound);
    }
    try {
      await bound;
    } catch (e) {
      if (this.bridgeBindings.get(page) === bound) this.bridgeBindings.delete(page);
      throw e;
    }
  }

  private async exposeBridge(page: any): Promise<void> {
    try {
      // The whole page can call a binding, WhatsApp Web's own scripts included: it serves only the current bridge's
      // call, refuses a message no mediasoup peer would send, and the room allows the page peer nothing beyond its own role.
      await page.exposeFunction('__mwBridgeSignal', async (callId: string, op: string, json: string) => {
        try {
          const slot = this.bridge;
          if (!slot || slot.callId !== callId) throw new Error('No media bridge for this call');
          if (String(json).length > MAX_SIGNAL_JSON) throw new Error('Media signalling message too large');
          return JSON.stringify((await runCallMediaSignal(slot.signaling, op, JSON.parse(json))) ?? null);
        } catch (e) {
          throw forPage(e);
        }
      });
    } catch (e) {
      if (!/already exists/.test(String((e as Error)?.message))) throw e; // an earlier attempt still holds our binding
    }
  }

  private requirePage(): any {
    const page = this.page();
    if (!page || !this.isReady()) throw new Error('Client not ready');
    return page;
  }

  /** One binding per page object; puppeteer keeps it across navigations. */
  private async bindRecording(page: any): Promise<void> {
    let bound = this.bindings.get(page);
    if (!bound) {
      bound = this.exposeRecording(page);
      this.bindings.set(page, bound);
    }
    try {
      await bound;
    } catch (e) {
      if (this.bindings.get(page) === bound) this.bindings.delete(page); // not a newer attempt's entry
      throw e;
    }
  }

  private async exposeRecording(page: any): Promise<void> {
    try {
      await page.exposeFunction('__mwRecordingChunk', (callId: string, b64: string) => {
        try {
          // A chunk that returned normally would count as delivered, so a chunk with no sink throws: the page counts it as lost.
          // Same for a chunk of another call: an earlier start that failed in Node after the page began leaves an orphan
          // recorder, and its audio must never land in the recording that holds the slot now.
          if (!this.recording) throw new Error('No recording in progress');
          if (this.recording.callId !== callId) throw new Error('Not recording this call');
          this.recording.onChunk(Buffer.from(b64, 'base64'));
        } catch (e) {
          throw forPage(e);
        }
      });
    } catch (e) {
      // "already exists": an earlier attempt failed after puppeteer took the name, so it still holds our binding
      if (!/already exists/.test(String((e as Error)?.message))) throw e;
    }
  }
}

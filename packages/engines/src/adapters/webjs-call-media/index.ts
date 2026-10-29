// MultiWA Gateway - call media for the whatsapp-web.js engine (Node side)
// packages/engines/src/adapters/webjs-call-media/index.ts
//
// Thin wrapper: every method runs one function of ./page inside the profile's WhatsApp Web page, and those
// functions check the call id themselves. The wrapper owns one piece of state: the recording slot (which sink gets
// the chunks, and the start in progress, so a stop can wait for it). Only used when EngineConfig.callMedia.enabled
// (the server switch CALLS_MEDIA_ENABLED).
import type { CallMediaEngine, CallMediaSupport, CallMediaUnsupportedReason } from '../../types';
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

const DEFAULT_ANSWER_TIMEOUT_MS = 15_000;
const HANG_UP_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const RECORDING_TIMESLICE_MS = 5_000;
const KNOWN_REASONS: ReadonlySet<string> = new Set(['web_calling_disabled', 'voip_stack_unavailable', 'module_missing', 'hooks_missing']);
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

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

  async playAnnouncement(callId: string, audio: Buffer): Promise<{ durationMs: number }> {
    return this.requirePage().evaluate(playAnnouncementInPage, callId, audio.toString('base64'));
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
        // A chunk that returned normally would count as delivered, so a chunk with no sink throws: the page counts it as lost.
        // Same for a chunk of another call: an earlier start that failed in Node after the page began leaves an orphan
        // recorder, and its audio must never land in the recording that holds the slot now.
        if (!this.recording) throw new Error('No recording in progress');
        if (this.recording.callId !== callId) throw new Error('Not recording this call');
        this.recording.onChunk(Buffer.from(b64, 'base64'));
      });
    } catch (e) {
      // "already exists": an earlier attempt failed after puppeteer took the name, so it still holds our binding
      if (!/already exists/.test(String((e as Error)?.message))) throw e;
    }
  }
}

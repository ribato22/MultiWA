// MultiWA Gateway - call media for the whatsapp-web.js engine (Node side)
// packages/engines/src/adapters/webjs-call-media/index.ts
//
// Thin wrapper: every method runs one function of ./page inside the profile's WhatsApp Web page. Only used
// when EngineConfig.callMedia.enabled (the server switch CALLS_MEDIA_ENABLED).
import type { CallMediaEngine, CallMediaSupport, CallMediaUnsupportedReason } from '../../types';
import {
  installCallMediaHooks,
  prepareCallMediaPage,
  probeCallMedia,
  answerActiveCall,
  hangUpActiveCall,
  isActiveCall,
  playAnnouncementInPage,
  startRecordingInPage,
  stopRecordingInPage,
} from './page';

export * from './page';

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
 * whatsapp-web.js `evalOnNewDoc` takes a script STRING. A function would lose its body when serialized
 * together with others, and the hooks must run on every new document (WA Web reloads itself).
 */
export const CALL_MEDIA_INIT_SCRIPT = `(${installCallMediaHooks.toString()})();`;

const DEFAULT_ANSWER_TIMEOUT_MS = 15_000;
const RECORDING_TIMESLICE_MS = 5_000;
const KNOWN_REASONS: ReadonlySet<string> = new Set(['web_calling_disabled', 'voip_stack_unavailable', 'module_missing']);
const clean = (s: string) => String(s).replace(/[\r\n]/g, '');

export class WebJsCallMedia implements CallMediaEngine {
  /**
   * The recording binding per page object, as the PENDING `exposeFunction`. puppeteer throws "already exists"
   * on a second `exposeFunction` of the same name, so each page gets exactly one attempt: concurrent callers
   * share it instead of binding twice, and a failed attempt is dropped so the next call retries.
   */
  private readonly bindings = new WeakMap<object, Promise<void>>();
  private onChunk: ((chunk: Buffer) => void) | null = null;

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
    await this.bindRecording(page);
    await page.keyboard.press('Shift').catch(() => undefined); // a trusted key press = user activation
    const r = await page.evaluate(prepareCallMediaPage);
    if (!r.hooks || !/^(granted|already granted)$/.test(r.micPermission)) {
      console.warn(`[WhatsApp-WebJS] call media page setup for profile ${this.profileId}: ${clean(JSON.stringify(r))}`);
    }
  }

  async getSupport(): Promise<CallMediaSupport> {
    const page = this.page();
    if (!page || !this.isReady()) return { supported: false, reasons: ['not_ready'] };
    try {
      const r = await page.evaluate(probeCallMedia);
      const reasons = r.reasons.filter((x: string) => KNOWN_REASONS.has(x)) as CallMediaUnsupportedReason[];
      return { supported: reasons.length === 0, reasons, waVersion: r.waVersion };
    } catch {
      return { supported: false, reasons: ['page_error'] };
    }
  }

  async answer(callId: string, opts?: { timeoutMs?: number }): Promise<{ connectedAfterMs: number }> {
    const r = await this.requirePage().evaluate(answerActiveCall, callId, opts?.timeoutMs ?? DEFAULT_ANSWER_TIMEOUT_MS);
    console.log(`[WhatsApp-WebJS] Call ${clean(callId)} answered for profile ${this.profileId}, connected after ${r.connectedAfterMs} ms`);
    return r;
  }

  async hangUp(callId: string): Promise<void> {
    await this.requirePage().evaluate(hangUpActiveCall, callId);
  }

  async playAnnouncement(callId: string, audio: Buffer): Promise<{ durationMs: number }> {
    const page = await this.activePage(callId);
    return page.evaluate(playAnnouncementInPage, audio.toString('base64'));
  }

  async startRecording(callId: string, onChunk: (chunk: Buffer) => void): Promise<void> {
    const page = await this.activePage(callId);
    await this.bindRecording(page);
    this.onChunk = onChunk;
    try {
      await page.evaluate(startRecordingInPage, RECORDING_TIMESLICE_MS);
    } catch (e) {
      this.onChunk = null;
      throw e;
    }
  }

  async stopRecording(_callId: string): Promise<{ durationMs: number }> {
    try {
      return await this.requirePage().evaluate(stopRecordingInPage);
    } finally {
      this.onChunk = null;
    }
  }

  private requirePage(): any {
    const page = this.page();
    if (!page || !this.isReady()) throw new Error('Client not ready');
    return page;
  }

  private async activePage(callId: string): Promise<any> {
    const page = this.requirePage();
    if (!(await page.evaluate(isActiveCall, callId))) throw new Error('Call is not the active call');
    return page;
  }

  /** One binding per page object; puppeteer keeps it across navigations. */
  private async bindRecording(page: any): Promise<void> {
    let bound = this.bindings.get(page);
    if (!bound) {
      bound = page.exposeFunction('__mwRecordingChunk', (b64: string) => {
        this.onChunk?.(Buffer.from(b64, 'base64'));
      });
      this.bindings.set(page, bound);
    }
    try {
      await bound;
    } catch (e) {
      this.bindings.delete(page);
      throw e;
    }
  }
}

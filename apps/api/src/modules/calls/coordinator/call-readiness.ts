// MultiWA Gateway - can a profile's calls be answered in the dashboard right now?
// apps/api/src/modules/calls/coordinator/call-readiness.ts
//
// Every reason that holds, the server's first, then the profile's, then its WhatsApp Web page's: the settings refuse
// with them (409), the status endpoint shows them, and a ringing banner says the first ("Answer on the phone").
import { withTimeout } from '@multiwa/engine-runtime';
import type { CallMediaUnsupportedReason, IWhatsAppEngine } from '@multiwa/engines';

export type CallReadinessReason =
  | 'engine_host_worker' // ENGINE_HOST=worker: the engines run in the worker, the media server only in the api
  | 'media_disabled' // CALLS_MEDIA_ENABLED is not true
  | 'media_server_down' // the media server's worker is not running (it is restarting)
  | 'auto_reject_on' // the profile rejects every call
  | 'profile_not_connected' // no engine for the profile in this process
  | 'engine_not_supported' // its engine has no call media (Baileys)
  | CallMediaUnsupportedReason;

export interface CallReadiness {
  ready: boolean;
  reasons: CallReadinessReason[];
}

/** The page probe is a page round trip: a hung page must hold neither the ring nor the settings. */
export const READINESS_PROBE_MS = 3_000;

export interface ReadinessDeps {
  engineHostWorker: boolean;
  media: { enabled: boolean; worker: 'up' | 'down' };
  engine: Pick<IWhatsAppEngine, 'callMedia'> | null;
}

export async function checkReadiness(settings: Record<string, unknown>, deps: ReadinessDeps): Promise<CallReadiness> {
  const reasons: CallReadinessReason[] = [];
  if (deps.engineHostWorker) reasons.push('engine_host_worker');
  if (!deps.media.enabled) reasons.push('media_disabled');
  else if (deps.media.worker !== 'up') reasons.push('media_server_down');
  if (settings.autoRejectCalls === true) reasons.push('auto_reject_on');
  if (!deps.engine) reasons.push('profile_not_connected');
  else if (deps.media.enabled) {
    const media = deps.engine.callMedia;
    if (!media) reasons.push('engine_not_supported');
    else {
      const support = await withTimeout(media.getSupport(), READINESS_PROBE_MS).catch(() => null);
      // A reply without its reasons list (from any engine) is a page error too, not a throw.
      if (!support?.supported) reasons.push(...(support?.reasons?.length ? support.reasons : (['page_error'] as const)));
    }
  }
  return { ready: reasons.length === 0, reasons };
}

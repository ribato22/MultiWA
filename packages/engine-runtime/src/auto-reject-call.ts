// MultiWA Gateway - Auto-reject incoming calls (shared engine runtime)
// packages/engine-runtime/src/auto-reject-call.ts
//
// Shared by the api and worker engine-manager forks: when a profile has
// `autoRejectCalls` enabled, incoming WhatsApp voice/video calls are rejected,
// and an optional configured message is sent back to the caller.

export interface AutoRejectCallSettings {
  autoRejectCalls?: boolean;
  /** Optional reply sent to the caller after rejecting. Blank = reject silently. */
  autoRejectCallMessage?: string;
}

export interface AutoRejectCallDeps {
  rejectCall: (callId: string) => Promise<void>;
  sendText?: (to: string, text: string) => Promise<void>;
  logger?: { log?: (m: string) => void; warn?: (m: string) => void };
}

/**
 * Reject an incoming call when the profile opted in, then optionally reply.
 * Returns true if the call was rejected, false if auto-reject was off / no id.
 * A failed reply is swallowed (the reject already succeeded).
 */
export async function handleAutoRejectCall(
  call: { id?: string; from?: string },
  settings: AutoRejectCallSettings | null | undefined,
  deps: AutoRejectCallDeps,
): Promise<boolean> {
  if (!settings?.autoRejectCalls || !call?.id) return false;

  await deps.rejectCall(call.id);
  deps.logger?.log?.(`Auto-rejected call ${call.id} from ${call.from ?? 'unknown'}`);

  const msg = settings.autoRejectCallMessage?.trim();
  if (msg && deps.sendText && call.from) {
    try {
      await deps.sendText(call.from, msg);
    } catch (e: any) {
      deps.logger?.warn?.(`auto-reject reply failed: ${e?.message ?? e}`);
    }
  }
  return true;
}

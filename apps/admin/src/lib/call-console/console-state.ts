// What the call console shows, as a pure function of the server's `call:*` events and the agent's own actions. The
// provider (components/calls/calls-provider.tsx) owns the socket, the audio and the side effects.

/** `call:ringing`, as the server sends it. */
export interface RingingCall {
  callId: string;
  profileId: string;
  profileName: string;
  caller: { name: string | null; number: string | null };
  conversationId?: string | null;
  startedAt: string;
  answerable: boolean;
  unavailableReason?: string;
  recorded: boolean;
}

export type Banner =
  | { call: RingingCall; status: 'ringing' }
  | { call: RingingCall; status: 'answering' } // this tab clicked Answer
  | { call: RingingCall; status: 'taken'; by: string } // another agent answered: it fades
  | { call: RingingCall; status: 'failed'; message: string }; // this tab's answer failed: it fades

export type CallPhase = 'connecting' | 'announcing' | 'active' | 'hanging_up' | 'ended';

export interface ActiveCall {
  call: RingingCall;
  phase: CallPhase;
  /** This tab holds the call's audio; another tab of the agent may hold it instead. */
  local: boolean;
  muted: boolean;
  answeredAt?: string;
  announcing?: { durationSec: number; since: number };
  /** How it ended, for the few seconds the bar still shows it. */
  endedText?: string;
  /** A hang-up or a reconnection that did not go through. */
  problem?: string;
}

export type Availability = 'available' | 'unavailable' | 'offline';

export interface ConsoleState {
  banners: Banner[];
  active: ActiveCall | null;
  availability: Availability;
  /** Calls this agent dismissed here: a re-ring of one stays away. */
  dismissed: string[];
}

export const initialState: ConsoleState = { banners: [], active: null, availability: 'offline', dismissed: [] };

export type ConsoleEvent =
  | { type: 'ringing'; call: RingingCall }
  | { type: 'claimed'; callId: string; byUserId: string; byUserName: string; me: string }
  | { type: 'answering'; callId: string }
  | { type: 'answerFailed'; callId: string; message: string }
  | { type: 'answered'; call: RingingCall }
  | { type: 'restored'; call: RingingCall; local: boolean }
  | { type: 'announcing'; callId: string; durationSec: number; at: number }
  | { type: 'active'; callId: string; answeredAt: string }
  | { type: 'ended'; callId: string; text: string | null }
  | { type: 'hangingUp' }
  | { type: 'hangUpFailed'; text: string }
  | { type: 'local'; callId: string; local: boolean }
  | { type: 'muted'; muted: boolean }
  | { type: 'problem'; text: string }
  | { type: 'dismiss'; callId: string }
  | { type: 'drop'; callId: string }
  | { type: 'availability'; available: boolean }
  | { type: 'offline' };

export function reduce(s: ConsoleState, e: ConsoleEvent): ConsoleState {
  const without = (callId: string) => s.banners.filter((b) => b.call.callId !== callId);
  const a = s.active;
  const isActive = (callId: string) => a?.call.callId === callId;
  switch (e.type) {
    case 'ringing':
      // A call rings again after an answer failed, for the agent who tried too; one dismissed here stays dismissed.
      if (s.dismissed.includes(e.call.callId) || isActive(e.call.callId)) return s;
      return { ...s, banners: [...without(e.call.callId), { call: e.call, status: 'ringing' }] };
    case 'claimed': {
      const b = s.banners.find((x) => x.call.callId === e.callId);
      if (!b || b.status === 'answering') return s; // this tab's own claim: its reply decides
      if (e.byUserId !== e.me) return { ...s, banners: s.banners.map((x) => (x === b ? { call: b.call, status: 'taken', by: e.byUserName } : x)) };
      // Another tab of this agent took it: the call shows here as theirs, its audio there.
      return { ...s, banners: without(e.callId), active: a ?? { call: b.call, phase: 'connecting', local: false, muted: false } };
    }
    case 'answering':
      return { ...s, banners: s.banners.map((x) => (x.call.callId === e.callId && x.status === 'ringing' ? { call: x.call, status: 'answering' } : x)) };
    case 'answerFailed':
      return {
        ...s,
        banners: s.banners.map((x) => (x.call.callId === e.callId && x.status === 'answering' ? { call: x.call, status: 'failed', message: e.message } : x)),
      };
    case 'answered':
      return { ...s, banners: without(e.call.callId), active: { call: e.call, phase: 'connecting', local: true, muted: false } };
    case 'restored':
      // A reload, the audio taken here from another tab, or rebuilt after it failed: "Connecting…" until call:active.
      return {
        ...s,
        banners: without(e.call.callId),
        active: { call: e.call, phase: 'connecting', local: e.local, muted: false, answeredAt: isActive(e.call.callId) ? a!.answeredAt : undefined },
      };
    case 'announcing':
      if (!isActive(e.callId) || a!.phase !== 'connecting') return s;
      return { ...s, active: { ...a!, phase: 'announcing', announcing: { durationSec: e.durationSec, since: e.at } } };
    case 'active':
      if (!isActive(e.callId) || a!.phase === 'ended' || a!.phase === 'hanging_up') return s;
      return { ...s, active: { ...a!, phase: 'active', answeredAt: e.answeredAt, announcing: undefined, problem: undefined } };
    case 'ended':
      if (!isActive(e.callId) || a!.phase === 'ended') return { ...s, banners: without(e.callId) };
      return { ...s, banners: without(e.callId), active: { ...a!, phase: 'ended', endedText: e.text ?? 'Call ended', problem: undefined } };
    case 'hangingUp':
      return a && a.phase !== 'ended' ? { ...s, active: { ...a, phase: 'hanging_up', problem: undefined } } : s;
    case 'hangUpFailed':
      return a?.phase === 'hanging_up' ? { ...s, active: { ...a, phase: a.answeredAt ? 'active' : 'connecting', problem: e.text } } : s;
    case 'local':
      return isActive(e.callId) ? { ...s, active: { ...a!, local: e.local } } : s;
    case 'muted':
      return a ? { ...s, active: { ...a, muted: e.muted } } : s;
    case 'problem':
      return a ? { ...s, active: { ...a, problem: e.text } } : s;
    case 'dismiss':
      return { ...s, banners: without(e.callId), dismissed: [...s.dismissed.slice(-49), e.callId] };
    case 'drop':
      return { ...s, banners: without(e.callId), active: isActive(e.callId) && a!.phase === 'ended' ? null : a };
    case 'availability':
      return { ...s, availability: e.available ? 'available' : 'unavailable' };
    case 'offline':
      return { ...s, availability: 'offline' };
  }
}

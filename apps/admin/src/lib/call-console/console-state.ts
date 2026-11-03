// What the call console shows, as a pure function of the server's `call:*` events and the agent's own actions. The
// provider (components/calls/calls-provider.tsx) owns the socket, the audio and the side effects.
import { ANSWER_FAILURE_TEXT } from '@/lib/calls';

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
  | { call: RingingCall; status: 'ringing'; notice?: string } // notice: why this tab's answer did not go through
  | { call: RingingCall; status: 'answering'; mine?: boolean } // this tab clicked Answer; mine: this agent claimed it
  | { call: RingingCall; status: 'taken'; by: string } // another agent answered: it fades
  | { call: RingingCall; status: 'failed'; message: string; reason?: string }; // this tab's answer failed: it fades; reason: the reply's

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
  | { type: 'answerFailed'; callId: string; message: string; reason?: string } // reason: the call:answer reply's
  | { type: 'answered'; call: RingingCall }
  | { type: 'restored'; call: RingingCall; local: boolean; muted?: boolean; answeredAt?: string } // stored with the call (a reload)
  | { type: 'announcing'; callId: string; durationSec: number; at: number }
  | { type: 'active'; callId: string; answeredAt: string }
  | { type: 'ended'; callId: string; text: string | null }
  | { type: 'hangingUp'; callId: string }
  | { type: 'hangUpFailed'; callId: string; text: string }
  | { type: 'local'; callId: string; local: boolean }
  | { type: 'muted'; muted: boolean }
  | { type: 'problem'; callId: string; text: string | null } // null: it is over
  | { type: 'dismiss'; callId: string }
  | { type: 'drop'; callId: string }
  | { type: 'availability'; available: boolean }
  | { type: 'offline' };

/** The call:answer refusals that come before a claim: someone else's claim won. */
const LOST_RACE = ['busy', 'already_claimed', 'not_ringing'];

export function reduce(s: ConsoleState, e: ConsoleEvent): ConsoleState {
  const without = (callId: string) => s.banners.filter((b) => b.call.callId !== callId);
  const a = s.active;
  const isActive = (callId: string) => a?.call.callId === callId;
  const live = (callId: string) => isActive(callId) && a!.phase !== 'ended';
  const banner = (callId: string) => s.banners.find((x) => x.call.callId === callId);
  const swap = (from: Banner, to: Banner) => s.banners.map((x) => (x === from ? to : x));
  // Another tab of this agent has the call: it shows here as theirs, its audio there. A call still on the bar stays.
  const theirs = (call: RingingCall): ConsoleState => ({
    ...s,
    banners: without(call.callId),
    active: a && a.phase !== 'ended' ? a : { call, phase: 'connecting', local: false, muted: false },
  });
  switch (e.type) {
    case 'ringing': {
      // A call rings again after an answer failed, for the agent who tried too; one dismissed here stays dismissed. The
      // failed answer's banner, or the ended call of a failed answer still fading on the bar, gives way to the ringing
      // banner, which keeps why it failed (the failed banner's message first). A lost race says nothing: it rings again
      // because the winner's answer failed, so "someone else answered" is stale.
      if (s.dismissed.includes(e.call.callId) || live(e.call.callId)) return s;
      const b = banner(e.call.callId);
      const notice = b?.status === 'failed' ? (LOST_RACE.includes(b.reason) ? undefined : b.message) : isActive(e.call.callId) ? a!.endedText : undefined;
      const ring: Banner = notice ? { call: e.call, status: 'ringing', notice } : { call: e.call, status: 'ringing' };
      return { ...s, banners: [...without(e.call.callId), ring], active: isActive(e.call.callId) ? null : a };
    }
    case 'claimed': {
      const b = banner(e.callId);
      if (!b) return s;
      // This tab's claim, or another tab of this agent racing it: the reply decides, and a refused one then knows who won.
      if (b.status === 'answering') return e.byUserId === e.me ? { ...s, banners: swap(b, { ...b, mine: true }) } : s;
      if (e.byUserId !== e.me) return { ...s, banners: swap(b, { call: b.call, status: 'taken', by: e.byUserName }) };
      return theirs(b.call);
    }
    case 'answering':
      return { ...s, banners: s.banners.map((x) => (x.call.callId === e.callId && x.status === 'ringing' ? { call: x.call, status: 'answering' } : x)) };
    case 'answerFailed': {
      const b = banner(e.callId);
      // Refused before this tab could claim (unavailable: the server did not run it), or no reason (its microphone was
      // refused before it asked): the claim seen here is another tab's.
      if (b?.status === 'answering' && b.mine && (e.reason === undefined || e.reason === 'unavailable' || LOST_RACE.includes(e.reason))) return theirs(b.call);
      // Not run: the server could not check this tab's socket, which reconnects. Nothing rings the call here again, so it
      // still rings, and says why.
      if (b?.status === 'answering' && e.reason === 'unavailable') return { ...s, banners: swap(b, { call: b.call, status: 'ringing', notice: e.message }) };
      // Rung again before the reply came: it still rings, and says why this answer did not go through. A lost race says
      // nothing, as when the ring comes after the reply: it rings again because the winner's answer failed.
      if (b?.status === 'ringing') return LOST_RACE.includes(e.reason) ? s : { ...s, banners: swap(b, { ...b, notice: e.message }) };
      // Any other refusal is this tab's own claim failing (the audio did not connect), and fades like any failed answer.
      if (b?.status === 'answering') return { ...s, banners: swap(b, { call: b.call, status: 'failed', message: e.message, reason: e.reason }) };
      return s;
    }
    case 'answered':
      return { ...s, banners: without(e.call.callId), active: { call: e.call, phase: 'connecting', local: true, muted: false } };
    case 'restored':
      // A reload, the audio taken here from another tab, or rebuilt after it failed: "Connecting…" until call:active.
      // What the server said of the call stays (a reload's from what was stored), for when this tab gives the audio up
      // again (local).
      return {
        ...s,
        banners: without(e.call.callId),
        active: {
          call: e.call,
          phase: 'connecting',
          local: e.local,
          muted: e.muted ?? (live(e.call.callId) && a!.muted),
          answeredAt: e.answeredAt ?? (isActive(e.call.callId) ? a!.answeredAt : undefined),
          announcing: isActive(e.call.callId) ? a!.announcing : undefined,
        },
      };
    case 'announcing':
      if (!isActive(e.callId) || (a!.phase !== 'connecting' && a!.phase !== 'hanging_up')) return s;
      // A hang-up under way stays one, but a failed one then goes back to the announcement.
      return { ...s, active: { ...a!, phase: a!.phase === 'hanging_up' ? 'hanging_up' : 'announcing', announcing: { durationSec: e.durationSec, since: e.at } } };
    case 'active':
      if (!live(e.callId)) return s;
      // A hang-up under way stays one, but a failed one then goes back to the call it hung up.
      if (a!.phase === 'hanging_up') return { ...s, active: { ...a!, answeredAt: e.answeredAt, announcing: undefined } };
      return { ...s, active: { ...a!, phase: 'active', answeredAt: e.answeredAt, announcing: undefined, problem: undefined } };
    case 'ended': {
      // A failed answer's banner stays to fade: if the call rings again, the new banner says why (a lost race says nothing).
      // So does an answer under way, which fails with the end: the call stopped ringing (it says so), or the claim of this
      // agent ended before it connected (its end says why).
      const b = banner(e.callId);
      const banners =
        b?.status === 'answering'
          ? swap(b, { call: b.call, status: 'failed', message: e.text ?? ANSWER_FAILURE_TEXT.not_ringing })
          : s.banners.filter((x) => x.call.callId !== e.callId || x.status === 'failed');
      if (!live(e.callId)) return { ...s, banners };
      return { ...s, banners, active: { ...a!, phase: 'ended', endedText: e.text ?? 'Call ended', problem: undefined } };
    }
    // A hang-up's result or a problem can come late, once the bar shows another call: each counts for its own call only.
    case 'hangingUp':
      return live(e.callId) ? { ...s, active: { ...a!, phase: 'hanging_up', problem: undefined } } : s;
    case 'hangUpFailed':
      if (!isActive(e.callId) || a!.phase !== 'hanging_up') return s;
      return { ...s, active: { ...a!, phase: a!.answeredAt ? 'active' : a!.announcing ? 'announcing' : 'connecting', problem: e.text } };
    case 'problem':
      return live(e.callId) ? { ...s, active: { ...a!, problem: e.text ?? undefined } } : s;
    case 'local': {
      if (!isActive(e.callId)) return s;
      // Audio this tab was building, given up (it failed, or another tab took it): the call is back in the phase the
      // server last said, so it can be taken here again.
      const phase = !e.local && a!.phase === 'connecting' ? (a!.answeredAt ? 'active' : a!.announcing ? 'announcing' : 'connecting') : a!.phase;
      return { ...s, active: { ...a!, local: e.local, phase } };
    }
    case 'muted':
      return a ? { ...s, active: { ...a, muted: e.muted } } : s;
    case 'dismiss':
      return { ...s, banners: without(e.callId), dismissed: [...s.dismissed.slice(-49), e.callId] };
    case 'drop':
      // A fade's end: only what fades goes. The timer can fire just after the call rang again.
      return {
        ...s,
        banners: s.banners.filter((b) => b.call.callId !== e.callId || b.status === 'ringing' || b.status === 'answering'),
        active: isActive(e.callId) && a!.phase === 'ended' ? null : a,
      };
    case 'availability':
      return { ...s, availability: e.available ? 'available' : 'unavailable' };
    case 'offline':
      return { ...s, availability: 'offline' };
    default: {
      // tsconfig is not strict: without this, a new event compiles and the reducer returns undefined.
      const unhandled: never = e;
      return s;
    }
  }
}

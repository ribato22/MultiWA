'use client';
// The call console, mounted once by the dashboard layout so a call lives on across pages: one socket per tab for the
// agent's events (the server sends them to the user's room, no `join`), the agent's commands, and the call's audio.
// The header's toggle, the banner and the in-call bar read it through useCalls().
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { ANSWER_FAILURE_TEXT, CALL_AUDIO_TEXT, HANG_UP_FAILED, NO_AUDIO, endedText, micProblem } from '@/lib/calls';
import { getSocketUrl } from '@/lib/socket';
import { canAnswerCalls, type CurrentUser } from '@/lib/current-user';
import { mediaSupported, startAgentMedia, type AgentMedia } from '@/lib/call-console/agent-media';
import { unlockAudio } from '@/lib/call-console/attention';
import { quality as toQuality, type Quality } from '@/lib/call-console/call-quality';
import { initialState, reduce, type ConsoleState, type RingingCall } from '@/lib/call-console/console-state';
import { prefs } from '@/lib/call-console/prefs';
import { toast } from '@/hooks/use-toast';
import { useRingingAttention } from './use-ringing-attention';

type Ack = { ok: true; [key: string]: any } | { ok: false; reason: string; message?: string };
/** A `call:*` command and its ack; no ack within `ms` reads as the reason `timeout`. */
const command = (socket: Socket, event: string, args: object, ms: number): Promise<Ack> =>
  socket.timeout(ms).emitWithAck(event, args).catch(() => ({ ok: false as const, reason: 'timeout' }));

// The server's own budgets: an answer connects within 10 s; a recorded call's hang-up stops the recorder before the
// media closes (up to about 27 s); a rejoin closes the old audio first (up to 8 s).
const ACK_MS = { availability: 5_000, answer: 15_000, media: 10_000, hangup: 40_000, rejoin: 15_000 };
const FADE_MS = 4_000; // "Answered by …" and a call's end stay this long

/**
 * sessionStorage, per user: the call whose audio this tab holds, with the agent's mute, this tab's producer and the
 * answer's time on it, so a reload rejoins it as it was (the server has no "my call" query).
 */
const callKey = (userId: string) => `multiwa:call:${userId}`;
interface StoredCall {
  call: RingingCall;
  muted: boolean;
  producer: string | null;
  answeredAt?: string;
}
const readStoredCall = (userId: string): StoredCall | null => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(callKey(userId)) ?? 'null');
    return stored?.call ? stored : null;
  } catch {
    return null;
  }
};
/** A sign-out forgets the call in this tab: the next login here must not rejoin it. */
export const forgetStoredCall = (userId: string) => sessionStorage.removeItem(callKey(userId));

/** The agent's microphone: the one chosen in Settings → Calls when it is still there. */
async function openMic(userId: string): Promise<MediaStreamTrack> {
  const deviceId = prefs.mic(userId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { ideal: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return stream.getAudioTracks()[0];
}

export interface CallsConsole {
  me: CurrentUser;
  state: ConsoleState;
  /** A profile rings in the dashboard, or a call is here: the header shows the call controls. */
  inUse: boolean;
  /** inUse is known: the profiles were read, or a call came first. Until then, false may mean not read yet. */
  inUseKnown: boolean;
  /** Why this page cannot answer calls (no HTTPS, or a browser the media library cannot drive), else null. */
  answerBlocked: string | null;
  /** The ringtone needs a click on the page first (the browser's autoplay rule). */
  soundBlocked: boolean;
  /** The call's network quality, while this tab holds its audio. */
  quality: Quality | null;
  /** The browser would not play the caller until a click (a tab reloaded mid-call). */
  playBlocked: boolean;
  /** The microphone this tab's call uses (its deviceId), once its audio is connected; '' while none is (it stopped). */
  micId: string | null;
  /** The console's socket is connected: while it is not, nothing about the call reaches this tab. */
  socketUp: boolean;
  /** The socket connected since the page loaded: until then, nothing says whether a call stored here goes on. */
  connectedOnce: boolean;
  setAvailable(on: boolean): void;
  dismiss(callId: string): void;
  answer(callId: string): void;
  hangUp(): void;
  setMuted(muted: boolean): void;
  switchMic(deviceId: string): void;
  resumeAudio(): void;
  takeHere(): void;
  /** A profile was set to answer its calls in the dashboard: the header shows the call controls from now on. */
  profileAnswers(): void;
}

type Commands = Pick<CallsConsole, 'setAvailable' | 'dismiss' | 'answer' | 'hangUp' | 'setMuted' | 'switchMic' | 'resumeAudio' | 'takeHere'>;

const CallsContext = createContext<CallsConsole | null>(null);
/** The console, or null for a login that takes no calls (a viewer). */
export const useCalls = () => useContext(CallsContext);

export function CallsProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const agent = canAnswerCalls(user.role);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [profilesRing, setProfilesRing] = useState(false);
  const [profilesRead, setProfilesRead] = useState(false);
  const cmd = useRef<Partial<Commands>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const [answerBlocked, setAnswerBlocked] = useState<string | null>(() =>
    typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia ? null : 'Calls in the dashboard need HTTPS',
  );
  const { soundBlocked, announcement } = useRingingAttention(state, user.id);
  const mediaRef = useRef<AgentMedia | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  const [micId, setMicId] = useState<string | null>(null);
  const [socketUp, setSocketUp] = useState(false);
  const [connectedOnce, setConnectedOnce] = useState(false);

  // Calls ring only for profiles that answer in the dashboard: without one, the header shows no call controls.
  useEffect(() => {
    if (!agent) return;
    void api.getProfiles().then(({ data }) => {
      const answers = !!data?.some((p) => p.settings?.callsAnswerInDashboard === true);
      setProfilesRing((rang) => rang || answers);
      setProfilesRead(true);
    });
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    let sentToken: string | null = null;
    let closed = false;
    const socket = io(`${getSocketUrl()}/ws`, {
      transports: ['websocket', 'polling'],
      // Read at every (re)connect, so a refreshed token is the one sent.
      auth: (cb) => {
        sentToken = localStorage.getItem('accessToken');
        cb({ token: sentToken ?? undefined });
      },
    });

    // ── connection ──
    // The availability is the server's, which keeps "unavailable" through a reload: the console shows what it confirms.
    const confirmed = (available: boolean) => dispatch({ type: 'availability', available });
    socket.on('connect', async () => {
      setSocketUp(true);
      setConnectedOnce(true);
      // Only a read: a choice this tab made before can be stale (another tab or device changed it since). A failed read
      // is tried once more: without one, the switch stays offline on a live socket.
      for (let tries = 0; tries < 2 && socket.connected; tries++) {
        const reply = await command(socket, 'call:availability', {}, ACK_MS.availability);
        if (reply.ok) return confirmed(reply.available);
      }
    });
    socket.on('disconnect', async (reason) => {
      // The call's audio can outlive the socket, but nothing about the call reaches this tab until it is back: the bar
      // says so meanwhile.
      setSocketUp(false);
      dispatch({ type: 'offline' });
      if (reason !== 'io server disconnect') return;
      // The server drops a socket whose token expired, or whose login is gone. A request's 401 refreshes an expired
      // token; the same token after one is a login that is gone, and no token is a sign-out.
      if (localStorage.getItem('accessToken') === sentToken) await api.me().catch(() => undefined);
      const token = localStorage.getItem('accessToken');
      if (!closed && token && token !== sentToken) socket.connect();
    });
    socket.on('call:availability', (p: { available: boolean }) => confirmed(p.available));
    const setAvailable = async (on: boolean) => {
      const reply = await command(socket, 'call:availability', { available: on }, ACK_MS.availability);
      if (reply.ok) confirmed(reply.available);
      else toast({ title: 'Your availability did not change', description: ANSWER_FAILURE_TEXT[reply.reason === 'timeout' ? 'timeout' : 'error'], variant: 'destructive' });
    };

    // ── ringing ──
    // The agent's other tabs hear of a Dismiss here: BroadcastChannel reaches the same browser's other tabs.
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`multiwa-calls:${user.id}`);
    channel?.addEventListener('message', ({ data }) => {
      if (data?.type === 'dismiss') dispatch({ type: 'dismiss', callId: data.callId });
    });
    // The reducer decides what a ring shows: a dismissed call stays away, a re-ring after a failed answer comes back.
    // A ring also proves a profile answers in the dashboard: the call controls stay once it is gone.
    socket.on('call:ringing', (call: RingingCall) => {
      setProfilesRing(true);
      dispatch({ type: 'ringing', call });
    });
    socket.on('call:claimed', (p: { callId: string; byUserId: string; byUserName: string }) => dispatch({ type: 'claimed', ...p, me: user.id }));
    socket.on('call:ended', (p: { callId: string; outcome?: string; endedBy?: string; endReason?: string; talkSeconds?: number | null }) =>
      dispatch({ type: 'ended', callId: p.callId, text: endedText(p) }),
    );
    const dismiss = (callId: string) => {
      dispatch({ type: 'dismiss', callId });
      channel?.postMessage({ type: 'dismiss', callId });
    };

    // ── the call ──
    // This tab's audio for a call is built by one attempt at a time, an answer's or a rejoin's. Every start and stop of
    // the audio bumps `attempt`: an older attempt still connecting sees that and gives up, and the media library closes
    // what it opened. Its microphone is stopped at once (`pendingMic`): the attempt may notice only later.
    let attempt = 0;
    let acquiring: string | null = null; // the call whose audio this tab is building
    let audioCallId: string | null = null; // the call whose audio this tab holds
    // This tab's producer on that call, from its produce reply: a call:active naming another is another tab's or
    // browser's. Kept while the audio is rebuilt, and over a reload (stored with the call): the previous producer's
    // call:active can come late, before the rejoin reached the server.
    let ownProducer: string | null = null;
    let muted = false; // the agent's mute, whatever media exists or is being built
    let answeredAt: string | undefined; // when the server put that call through (call:active)
    // The microphone of the attempt building the audio, until the media has it: a rejoin's from the moment it opens, an
    // answer's from the claim's reply. Mute and Hang up reach it there, and a stop ends it.
    let pendingMic: MediaStreamTrack | null = null;
    let hangingUp = false; // this tab's Hang up is on its way: no audio of the call is heard from here meanwhile
    let micGone: AgentMedia | null = null; // the audio whose microphone stopped, until another one is open
    let micSaid: string | null = null; // what the bar last said of the microphone
    let asking = 0; // the attempt whose call:rejoin is out: only from its emit to its reply, not while its microphone opens
    /**
     * A call:active naming another producer than this tab's, for the call whose rejoin this tab has out: sent before that
     * rejoin's reply, it is older than the rejoin, which decides. This tab neither lets go nor shows the call as on.
     */
    const older = (p: { callId: string; agentProducerId?: string }) =>
      !!p.agentProducerId && p.agentProducerId !== ownProducer && asking === attempt && p.callId === acquiring;
    const mineCall = () => audioCallId ?? acquiring;
    const stored = () => readStoredCall(user.id);
    const storedCall = () => stored()?.call ?? null;
    /** Stores the call (or forgets it: null) with the mute, the producer and the answer; `keep()` writes them to the call stored. */
    const keep = (call: RingingCall | null = storedCall()) => {
      if (!call) return forgetStoredCall(user.id);
      const entry: StoredCall = { call, muted, producer: ownProducer, answeredAt };
      sessionStorage.setItem(callKey(user.id), JSON.stringify(entry));
    };
    const stopAudio = () => {
      attempt++;
      micGone = null;
      acquiring = null;
      pendingMic?.stop(); // the browser's microphone light goes off now, not once the attempt notices
      pendingMic = null;
      mediaRef.current?.close();
      mediaRef.current = null;
      audioCallId = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      setQuality(null);
      setPlayBlocked(false);
      setMicId(null);
    };
    const onAudioFailed = (callId: string) => {
      // The audio failed (the network, or the server closed this peer): it goes now, its microphone too, and is built
      // again as after a reload, once there is a socket to ask. Not while this tab hangs it up (hangUp builds it again if
      // the hang-up fails).
      stopAudio();
      if (hangingUp) return;
      const call = storedCall();
      if (call?.callId === callId && socket.connected) void rejoin(call);
    };
    /** The call's audio in this tab: mediasoup over this socket, and the caller in the hidden <audio>. */
    // `reply`: the ok reply of call:answer or call:rejoin ({ callerProducerId, iceServers }). `mine`: the attempt it is.
    const startAudio = async (callId: string, reply: Record<string, any>, mic: MediaStreamTrack, mine: number) => {
      const media = await startAgentMedia({
        signal: async (op, args) => {
          if (mine !== attempt) throw new Error('This audio was given up');
          const ack = await command(socket, 'call:media', { callId, op, ...args }, ACK_MS.media);
          if (!ack.ok) throw new Error(ack.message ?? ack.reason);
          if (op === 'produce' && mine === attempt) {
            ownProducer = ack.result.id;
            keep();
          }
          return ack.result;
        },
        callerProducerId: reply.callerProducerId,
        iceServers: reply.iceServers ?? [],
        mic,
        muted,
      });
      // Given up as it connected: the call ended or moved, or the console went.
      if (mine !== attempt || closed) return media.close();
      media.setMuted(muted || hangingUp); // a Mute or a Hang up pressed while it connected
      mediaRef.current = media;
      pendingMic = null;
      audioCallId = callId;
      acquiring = null;
      setMicId(mic.getSettings().deviceId ?? null);
      media.onFailed(() => {
        if (mediaRef.current === media) onAudioFailed(callId);
      });
      media.onMicEnded(() => {
        if (mediaRef.current !== media) return;
        micGone = media;
        setMicId('');
        void reopenMic(media, callId);
      });
      const el = audioRef.current!;
      el.srcObject = media.remote;
      // A tab reloaded mid-call has had no click yet: the browser may not play the caller until there is one.
      el.play().then(
        () => setPlayBlocked(false),
        () => setPlayBlocked(true),
      );
    };
    /**
     * The call's microphone stopped (unplugged): another one opens by itself, the one chosen in Settings → Calls if it is
     * there, else the browser's own, and the agent is told which. With none to open, the agent is told why, and the next
     * microphone plugged in is tried. The choice stored stays the agent's.
     */
    const reopenMic = async (media: AgentMedia, callId: string) => {
      let mic: MediaStreamTrack | undefined;
      try {
        mic = await openMic(user.id);
        if (micGone !== media) return mic.stop(); // the call's audio went, or the agent chose one meanwhile
        await media.replaceMic(mic);
      } catch (e) {
        mic?.stop();
        if (micGone !== media) return;
        dispatch({ type: 'problem', callId, text: (micSaid = micProblem(e)) });
        navigator.mediaDevices.addEventListener('devicechange', () => micGone === media && void reopenMic(media, callId), { once: true });
        return;
      }
      if (micGone !== media) return; // the audio went meanwhile, and its close stops this microphone too
      micGone = null;
      setMicId(mic.getSettings().deviceId ?? '');
      dispatch({ type: 'problem', callId, text: (micSaid = `The microphone stopped: the call now uses ${mic.label || 'the browser’s default microphone'}`) });
    };
    socket.on('call:announcing', (p: { callId: string; durationSec: number }) =>
      dispatch({ type: 'announcing', callId: p.callId, durationSec: p.durationSec, at: Date.now() }),
    );
    socket.on('call:active', (p: { callId: string; answeredAt: string; agentProducerId?: string }) => {
      if (!older(p)) dispatch({ type: 'active', callId: p.callId, answeredAt: p.answeredAt });
      // Stored with the call: a reload that cannot take it back shows it as the call it is, to take here.
      if (storedCall()?.callId !== p.callId) return;
      answeredAt = p.answeredAt;
      keep();
    });
    socket.on('call:ended', (p: { callId: string }) => {
      if (p.callId === mineCall()) stopAudio(); // audio still connecting goes too
      if (storedCall()?.callId === p.callId) keep(null);
    });

    const answer = async (callId: string) => {
      const banner = stateRef.current.banners.find((b) => b.call.callId === callId);
      if (!banner || banner.status !== 'ringing') return;
      // Inside the click: this page may sound from now on, so a later call rings here even if no ringer was running to
      // catch a click (the ringer muted, or quiet while another call was up).
      unlockAudio();
      dispatch({ type: 'answering', callId });
      let mic: MediaStreamTrack;
      try {
        // Before the claim: a permission prompt must not eat the 10 s the server gives the answer to connect.
        mic = await openMic(user.id);
      } catch (e) {
        dispatch({ type: 'answerFailed', callId, message: micProblem(e) });
        return;
      }
      if (closed) return mic.stop(); // the console went (a sign-out) while the microphone opened
      const reply = await command(socket, 'call:answer', { callId }, ACK_MS.answer);
      if (closed) return mic.stop();
      if (!reply.ok) {
        mic.stop();
        dispatch({ type: 'answerFailed', callId, reason: reply.reason, message: ANSWER_FAILURE_TEXT[reply.reason] ?? ANSWER_FAILURE_TEXT.error });
        return;
      }
      muted = false;
      ownProducer = null;
      answeredAt = undefined;
      stopAudio();
      const mine = attempt;
      acquiring = callId;
      pendingMic = mic;
      keep(banner.call);
      dispatch({ type: 'answered', call: banner.call });
      try {
        await startAudio(callId, reply, mic, mine);
      } catch {
        // Given up meanwhile: the call ended (the server's connect timer, for one), another tab or device of the agent
        // took it, or the console went. Whoever gave it up closed it, and there is nothing to give back from here.
        if (mine !== attempt) return;
        // Claimed, but this browser could not connect: say so first (the server's own call:ended says less), then give
        // the call back, so it rings again for the others.
        stopAudio();
        keep(null);
        dispatch({ type: 'ended', callId, text: NO_AUDIO });
        await command(socket, 'call:hangup', { callId }, ACK_MS.hangup);
      }
    };
    const hangUp = async () => {
      const a = stateRef.current.active;
      if (!a || a.phase === 'ended' || a.phase === 'hanging_up') return;
      // Giving up a call while it connects rings it again for everyone, this agent too: it stays away here.
      if (a.phase === 'connecting') dismiss(a.call.callId);
      dispatch({ type: 'hangingUp', callId: a.call.callId });
      // Nothing more the agent says reaches the caller, or a recording, audio still being built included: a recorded
      // call's hang-up takes up to half a minute.
      hangingUp = true;
      if (pendingMic) pendingMic.enabled = false;
      mediaRef.current?.setMuted(true);
      const reply = await command(socket, 'call:hangup', { callId: a.call.callId }, ACK_MS.hangup);
      hangingUp = false;
      if (reply.ok || reply.reason === 'not_in_call') {
        if (mineCall() === a.call.callId) stopAudio();
        if (storedCall()?.callId === a.call.callId) keep(null);
        dispatch({ type: 'ended', callId: a.call.callId, text: 'You hung up' }); // call:ended has usually said so already
        return;
      }
      // The call goes on, muted or not as the agent had it; its audio, if it failed meanwhile, is built again.
      if (pendingMic) pendingMic.enabled = !muted;
      mediaRef.current?.setMuted(muted);
      dispatch({ type: 'hangUpFailed', callId: a.call.callId, text: HANG_UP_FAILED });
      const call = storedCall();
      if (call?.callId !== a.call.callId || mineCall() === call.callId || !socket.connected) return;
      void rejoin(call);
      dispatch({ type: 'problem', callId: call.callId, text: HANG_UP_FAILED }); // still said while it reconnects
    };
    const setMuted = (on: boolean) => {
      muted = on;
      if (pendingMic) pendingMic.enabled = !on;
      mediaRef.current?.setMuted(on);
      keep(); // a reload keeps it
      dispatch({ type: 'muted', muted: on });
    };
    const switchMic = async (deviceId: string) => {
      prefs.setMic(user.id, deviceId);
      const media = mediaRef.current;
      const callId = audioCallId;
      if (!media || !callId) return;
      let next: MediaStreamTrack | undefined;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        next = stream.getAudioTracks()[0];
        await media.replaceMic(next);
        setMicId(next.getSettings().deviceId ?? deviceId);
        micGone = null;
        // What the bar said of the microphone before is over.
        if (micSaid && stateRef.current.active?.problem === micSaid) dispatch({ type: 'problem', callId, text: null });
      } catch {
        next?.stop();
        dispatch({ type: 'problem', callId, text: 'That microphone could not be used' });
      }
    };
    const resumeAudio = () => {
      audioRef.current?.play().then(
        () => setPlayBlocked(false),
        () => undefined,
      );
    };

    // ── this tab and the others ──
    /** Another tab or device of the agent has the call: this tab lets go of its audio, of what it was building, and of the call it stored. */
    const letGo = (callId: string) => {
      if (callId === mineCall()) stopAudio();
      if (storedCall()?.callId === callId) keep(null);
      dispatch({ type: 'local', callId, local: false });
    };
    socket.on('call:active', (p: { callId: string; agentProducerId?: string }) => {
      // Another producer on the call than this tab's: another tab or browser of this agent took it. Not an older one.
      if (!p.agentProducerId || p.agentProducerId === ownProducer || older(p)) return;
      letGo(p.callId);
    });
    /**
     * This tab takes the call's audio: after a reload, when its own audio failed, or from another tab or device (`take`:
     * Take the call here). Unless taken, it names the producer it had: one that moved meanwhile stays where it is.
     */
    const rejoin = async (call: RingingCall, take = false) => {
      stopAudio();
      const mine = attempt;
      acquiring = call.callId;
      const superseded = () => mine !== attempt || closed;
      // The mute, the producer and the answer this tab had on the call, a reload ago too; else what the bar shows.
      const own = stored();
      const a = stateRef.current.active;
      const shown = a?.call.callId === call.callId && a.phase !== 'ended' ? a : null;
      if (own?.call.callId === call.callId) {
        muted = own.muted;
        ownProducer = own.producer;
        answeredAt = own.answeredAt ?? shown?.answeredAt;
      } else {
        muted = shown?.muted ?? false;
        ownProducer = null;
        answeredAt = shown?.answeredAt;
      }
      const ifProducerId = take ? undefined : (ownProducer ?? undefined);
      dispatch({ type: 'restored', call, local: true, muted, answeredAt });
      // Given up here: the call shows as it is, to take here again, and is no longer this tab's to rejoin by itself.
      const fail = (text: string) => {
        stopAudio();
        if (storedCall()?.callId === call.callId) keep(null);
        dispatch({ type: 'local', callId: call.callId, local: false });
        dispatch({ type: 'problem', callId: call.callId, text });
      };
      // The socket went: the call stored here (a reload's, or this tab's own audio that failed) is rejoined by the
      // connect, once the socket is back.
      const waitForSocket = () => (storedCall()?.callId === call.callId ? stopAudio() : fail(CALL_AUDIO_TEXT.rejoinFailed));
      let mic: MediaStreamTrack;
      try {
        mic = await openMic(user.id);
      } catch (e) {
        if (!superseded()) fail(micProblem(e));
        return;
      }
      // Given up while the microphone opened: the call ended or moved, or the console went (a sign-out).
      if (superseded()) return mic.stop();
      pendingMic = mic;
      mic.enabled = !(muted || hangingUp);
      if (!socket.connected) return waitForSocket();
      asking = mine;
      const reply = await command(socket, 'call:rejoin', { callId: call.callId, ifProducerId }, ACK_MS.rejoin);
      if (superseded()) return mic.stop();
      asking = 0;
      if (!reply.ok) {
        if (!socket.connected) return waitForSocket();
        if (reply.reason === 'moved') return letGo(call.callId); // it stays there, and shows here as theirs
        if (reply.reason !== 'not_in_call' && reply.reason !== 'not_allowed') return fail(CALL_AUDIO_TEXT.rejoinFailed);
        stopAudio();
        keep(null);
        dispatch({ type: 'ended', callId: call.callId, text: 'The call is over' });
        return;
      }
      // Only now does the tab that had the audio let go: if this tab could not take it, that one keeps it.
      channel?.postMessage({ type: 'media', callId: call.callId });
      keep(call);
      try {
        await startAudio(call.callId, reply, mic, mine);
      } catch {
        if (mine !== attempt) return; // given up meanwhile: whoever gave it up closed it
        if (!socket.connected) waitForSocket();
        else fail(CALL_AUDIO_TEXT.rejoinFailed);
      }
    };
    // A reload's call shows at once, as it was stored: the connect rejoins it, or finds it over or moved.
    const reloaded = stored();
    if (reloaded) dispatch({ type: 'restored', call: reloaded.call, local: true, muted: reloaded.muted, answeredAt: reloaded.answeredAt });
    socket.on('connect', () => {
      const call = storedCall();
      const { banners, active } = stateRef.current;
      // This tab's call, with no audio here and none being built: a reload, or its audio lost while the socket was down.
      // However long it was down, the rejoin's answer says whether the call is still this tab's to take back; a call it
      // let go of is no longer stored. Not while it hangs the call up.
      const rejoining = !!call && !mediaRef.current && acquiring !== call.callId && !hangingUp;
      if (rejoining) void rejoin(call);
      // A socket that was down missed what happened meanwhile: every call this tab shows is read again.
      for (const b of banners) {
        void api.getCall(b.call.callId).then(({ data }) => {
          if (data && data.outcome !== 'ringing') dispatch({ type: 'ended', callId: b.call.callId, text: null });
        });
      }
      if (active && active.phase !== 'ended' && !(rejoining && active.call.callId === call?.callId)) {
        const callId = active.call.callId;
        const read = (again: boolean) =>
          void api.getCall(callId).then(({ data }) => {
            const shown = stateRef.current.active;
            if (!data || closed || shown?.call.callId !== callId || shown.phase === 'ended') return;
            // This tab's own call, or another tab's that this agent answered: the call goes on.
            if (!data.endedAt && (shown.local || (data.outcome === 'answered' && data.answeredByUserId === user.id))) return;
            // Ringing: another tab's answer may still be connecting (the read hides who claimed a call). That answer
            // connects or is given back within the server's time for it, and this tab hears which: it is read again then.
            if (!data.endedAt && data.outcome === 'ringing' && !again) return void setTimeout(() => read(true), ACK_MS.answer);
            // Over, or no tab of this agent has it: another agent's, or ringing for everyone again.
            if (mineCall() === callId) stopAudio();
            if (storedCall()?.callId === callId) keep(null);
            dispatch({ type: 'ended', callId, text: 'Call ended' });
          });
        read(false);
      }
    });
    channel?.addEventListener('message', ({ data }) => {
      // Another tab of this browser took the call's audio.
      if (data?.type === 'media') letGo(data.callId);
    });
    const takeHere = () => {
      const a = stateRef.current.active;
      // Not while it connects: the server rejoins only a call it put through (announcing, then active).
      if (a && !a.local && (a.phase === 'announcing' || a.phase === 'active')) void rejoin(a.call, true);
    };

    cmd.current = { setAvailable, dismiss, answer, hangUp, setMuted, switchMic, resumeAudio, takeHere };
    return () => {
      cmd.current = {};
      closed = true;
      channel?.close();
      socket.disconnect();
      stopAudio(); // an attempt still connecting sees it, and closes its own
    };
  }, [agent, user.id]);

  // "Answered by …", a failed answer and a call's end show for a moment, then go: each call on its own timer, from when
  // it started to fade, so another call's news does not hold it up. A call that stops fading (it rings again) keeps none.
  const fades = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const fading = state.banners.filter((b) => b.status === 'taken' || b.status === 'failed').map((b) => b.call.callId);
    if (state.active?.phase === 'ended') fading.push(state.active.call.callId);
    for (const [callId, timer] of fades.current) {
      if (fading.includes(callId)) continue;
      clearTimeout(timer);
      fades.current.delete(callId);
    }
    for (const callId of fading) {
      if (fades.current.has(callId)) continue;
      const timer = setTimeout(() => {
        fades.current.delete(callId);
        dispatch({ type: 'drop', callId });
      }, FADE_MS);
      fades.current.set(callId, timer);
    }
  }, [state.banners, state.active]);
  useEffect(
    () => () => {
      fades.current.forEach(clearTimeout);
      fades.current.clear();
    },
    [],
  );

  // The network quality, every 2 s, while this tab holds the call's audio.
  const hasAudio = !!state.active?.local && state.active.phase !== 'ended';
  useEffect(() => {
    if (!hasAudio) return;
    const timer = setInterval(async () => {
      const media = mediaRef.current;
      try {
        const sample = await media?.sample();
        // One that comes back once its audio went (the call ended, or its audio is built again) says nothing of the call.
        if (sample && mediaRef.current === media) setQuality(toQuality(sample));
      } catch {
        // a transport closed meanwhile: the next sample, or the call's end
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [hasAudio]);

  // Leaving the page drops the call's audio here: the browser asks first.
  useEffect(() => {
    if (!hasAudio) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasAudio]);

  // A browser the media library cannot drive is told so before any call is claimed, not after.
  useEffect(() => {
    if (!agent || answerBlocked) return;
    void mediaSupported().then((ok) => {
      if (!ok) setAnswerBlocked('This browser cannot answer calls: use a current Chrome, Edge, Firefox or Safari');
    });
  }, [agent]);

  const inUse = profilesRing || !!state.active || state.banners.length > 0;
  const value = useMemo<CallsConsole | null>(
    () =>
      agent
        ? {
            me: user,
            state,
            inUse,
            inUseKnown: profilesRead || inUse,
            answerBlocked,
            soundBlocked,
            quality,
            playBlocked,
            micId,
            socketUp,
            connectedOnce,
            setAvailable: (on) => cmd.current.setAvailable?.(on),
            dismiss: (callId) => cmd.current.dismiss?.(callId),
            answer: (callId) => cmd.current.answer?.(callId),
            hangUp: () => cmd.current.hangUp?.(),
            setMuted: (muted) => cmd.current.setMuted?.(muted),
            switchMic: (deviceId) => cmd.current.switchMic?.(deviceId),
            resumeAudio: () => cmd.current.resumeAudio?.(),
            takeHere: () => cmd.current.takeHere?.(),
            profileAnswers: () => setProfilesRing(true),
          }
        : null,
    [agent, user, state, inUse, profilesRead, answerBlocked, soundBlocked, quality, playBlocked, micId, socketUp, connectedOnce],
  );
  return (
    <CallsContext.Provider value={value}>
      {children}
      {agent && (
        <>
          {/* The caller's voice: the element lives as long as the layout, so a call outlives page changes. */}
          <audio ref={audioRef} hidden />
          <div id="calls-announcer" aria-live="assertive" aria-atomic="true" className="sr-only">
            <span key={announcement.id}>{announcement.text}</span>
          </div>
        </>
      )}
    </CallsContext.Provider>
  );
}

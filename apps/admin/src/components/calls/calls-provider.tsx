'use client';
// The call console, mounted once by the dashboard layout so a call lives on across pages: one socket per tab for the
// agent's events (the server sends them to the user's room, no `join`), the agent's commands, and the call's audio.
// The header's toggle, the banner and the in-call bar read it through useCalls().
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { ANSWER_FAILURE_TEXT, endedText } from '@/lib/calls';
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
// media closes (up to about 27 s).
const ACK_MS = { availability: 5_000, answer: 15_000, media: 10_000, hangup: 40_000 };
const FADE_MS = 4_000; // "Answered by …" and a call's end stay this long

/** sessionStorage: the call whose audio this tab holds, so a reload can rejoin it (the server has no "my call" query). */
const CALL_KEY = 'multiwa:call';
const storedCall = (): RingingCall | null => {
  try {
    return JSON.parse(sessionStorage.getItem(CALL_KEY) ?? 'null');
  } catch {
    return null;
  }
};

/** The agent's microphone: the one chosen in Settings → Calls when it is still there. */
async function openMic(userId: string): Promise<MediaStreamTrack> {
  const deviceId = prefs.mic(userId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { ideal: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return stream.getAudioTracks()[0];
}
const micProblem = (e: unknown) =>
  (e as DOMException)?.name === 'NotAllowedError'
    ? 'Allow the microphone for this site to answer calls'
    : (e as DOMException)?.name === 'NotFoundError'
      ? 'No microphone found: plug one in and try again'
      : 'The microphone could not be opened';

export interface CallsConsole {
  me: CurrentUser;
  state: ConsoleState;
  /** A profile rings in the dashboard, or a call is here: the header shows the call controls. */
  inUse: boolean;
  /** Why this page cannot answer calls (no HTTPS, or a browser the media library cannot drive), else null. */
  answerBlocked: string | null;
  /** The ringtone needs a click on the page first (the browser's autoplay rule). */
  soundBlocked: boolean;
  /** The call's network quality, while this tab holds its audio. */
  quality: Quality | null;
  /** The browser would not play the caller until a click (a tab reloaded mid-call). */
  playBlocked: boolean;
  setAvailable(on: boolean): void;
  dismiss(callId: string): void;
  answer(callId: string): void;
  hangUp(): void;
  setMuted(muted: boolean): void;
  switchMic(deviceId: string): void;
  resumeAudio(): void;
}

type Commands = Pick<CallsConsole, 'setAvailable' | 'dismiss' | 'answer' | 'hangUp' | 'setMuted' | 'switchMic' | 'resumeAudio'>;

const CallsContext = createContext<CallsConsole | null>(null);
/** The console, or null for a login that takes no calls (a viewer). */
export const useCalls = () => useContext(CallsContext);

export function CallsProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const agent = canAnswerCalls(user.role);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [profilesRing, setProfilesRing] = useState(false);
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

  // Calls ring only for profiles that answer in the dashboard: without one, the header shows no call controls.
  useEffect(() => {
    if (!agent) return;
    void api.getProfiles().then(({ data }) => {
      const answers = !!data?.some((p) => p.settings?.callsAnswerInDashboard === true);
      setProfilesRing((rang) => rang || answers);
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
      // Only a read: a choice this tab made before can be stale (another tab or device changed it since). A failed read
      // is tried once more: without one, the switch stays offline on a live socket.
      for (let tries = 0; tries < 2 && socket.connected; tries++) {
        const reply = await command(socket, 'call:availability', {}, ACK_MS.availability);
        if (reply.ok) return confirmed(reply.available);
      }
    });
    socket.on('disconnect', async (reason) => {
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
    let audioCallId: string | null = null; // the call whose audio this tab holds
    const gone = new Set<string>(); // calls the server ended: audio that connects late is closed at once
    const keep = (call: RingingCall | null) => (call ? sessionStorage.setItem(CALL_KEY, JSON.stringify(call)) : sessionStorage.removeItem(CALL_KEY));
    const stopAudio = () => {
      mediaRef.current?.close();
      mediaRef.current = null;
      audioCallId = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      setQuality(null);
      setPlayBlocked(false);
    };
    const onAudioFailed = (callId: string) => dispatch({ type: 'problem', callId, text: 'The call’s audio dropped' });
    /** The call's audio in this tab: mediasoup over this socket, and the caller in the hidden <audio>. */
    // `reply`: the ok reply of call:answer or call:rejoin ({ callerProducerId, iceServers }).
    // `muted`: a call rebuilt while the agent was muted (a reload, a failure) starts muted.
    const startAudio = async (callId: string, reply: Record<string, any>, mic: MediaStreamTrack, muted = false) => {
      stopAudio();
      const media = await startAgentMedia({
        signal: async (op, args) => {
          const ack = await command(socket, 'call:media', { callId, op, ...args }, ACK_MS.media);
          if (!ack.ok) throw new Error(ack.message ?? ack.reason);
          return ack.result;
        },
        callerProducerId: reply.callerProducerId,
        iceServers: reply.iceServers ?? [],
        mic,
        muted,
      });
      if (gone.has(callId)) return media.close(); // it ended while its audio connected
      mediaRef.current = media;
      audioCallId = callId;
      media.onFailed(() => {
        if (mediaRef.current === media) onAudioFailed(callId);
      });
      media.onMicEnded(() => {
        if (mediaRef.current === media) dispatch({ type: 'problem', callId, text: 'The microphone stopped: plug it back in, or choose another one' });
      });
      const el = audioRef.current!;
      el.srcObject = media.remote;
      // A tab reloaded mid-call has had no click yet: the browser may not play the caller until there is one.
      el.play().then(
        () => setPlayBlocked(false),
        () => setPlayBlocked(true),
      );
    };
    socket.on('call:announcing', (p: { callId: string; durationSec: number }) =>
      dispatch({ type: 'announcing', callId: p.callId, durationSec: p.durationSec, at: Date.now() }),
    );
    socket.on('call:active', (p: { callId: string; answeredAt: string }) => dispatch({ type: 'active', callId: p.callId, answeredAt: p.answeredAt }));
    socket.on('call:ended', (p: { callId: string }) => {
      gone.add(p.callId);
      if (p.callId === audioCallId) stopAudio();
      if (storedCall()?.callId === p.callId) keep(null);
    });

    const answer = async (callId: string) => {
      const banner = stateRef.current.banners.find((b) => b.call.callId === callId);
      if (!banner || banner.status !== 'ringing') return;
      // Inside the click: this page may sound from now on, so a later call rings here even if no ringer was running to
      // catch a click (the ringer muted, or quiet while another call was up).
      unlockAudio();
      gone.delete(callId); // a call that rings again after a failed answer can be answered again
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
      if (!reply.ok) {
        mic.stop();
        dispatch({ type: 'answerFailed', callId, reason: reply.reason, message: ANSWER_FAILURE_TEXT[reply.reason] ?? ANSWER_FAILURE_TEXT.error });
        return;
      }
      keep(banner.call);
      dispatch({ type: 'answered', call: banner.call });
      try {
        await startAudio(callId, reply, mic);
      } catch {
        // Claimed, but this browser could not connect: say so first (the server's own call:ended says less), then give
        // the call back, so it rings again for the others. A call the server already ended (its connect timer) was
        // given back already, and may be ringing again: nothing to undo then.
        stopAudio();
        keep(null);
        if (gone.has(callId)) return;
        dispatch({ type: 'ended', callId, text: 'Could not connect audio' });
        await command(socket, 'call:hangup', { callId }, ACK_MS.hangup);
      }
    };
    const hangUp = async () => {
      const a = stateRef.current.active;
      if (!a || a.phase === 'ended' || a.phase === 'hanging_up') return;
      // Giving up a call while it connects rings it again for everyone, this agent too: it stays away here.
      if (a.phase === 'connecting') dismiss(a.call.callId);
      dispatch({ type: 'hangingUp', callId: a.call.callId });
      const reply = await command(socket, 'call:hangup', { callId: a.call.callId }, ACK_MS.hangup);
      if (reply.ok || reply.reason === 'not_in_call') {
        if (audioCallId === a.call.callId) stopAudio();
        if (storedCall()?.callId === a.call.callId) keep(null);
        dispatch({ type: 'ended', callId: a.call.callId, text: 'You hung up' }); // call:ended has usually said so already
      } else dispatch({ type: 'hangUpFailed', callId: a.call.callId, text: 'The hang-up did not go through: try again' });
    };
    const setMuted = (muted: boolean) => {
      mediaRef.current?.setMuted(muted);
      dispatch({ type: 'muted', muted });
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

    cmd.current = { setAvailable, dismiss, answer, hangUp, setMuted, switchMic, resumeAudio };
    return () => {
      cmd.current = {};
      closed = true;
      channel?.close();
      socket.disconnect();
      stopAudio();
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
      try {
        const sample = await mediaRef.current?.sample();
        if (sample) setQuality(toQuality(sample));
      } catch {
        // a transport closed meanwhile: the next sample, or the call's end
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [hasAudio]);

  // A browser the media library cannot drive is told so before any call is claimed, not after.
  useEffect(() => {
    if (!agent || answerBlocked) return;
    void mediaSupported().then((ok) => {
      if (!ok) setAnswerBlocked('This browser cannot answer calls: use a current Chrome, Edge, Firefox or Safari');
    });
  }, [agent]);

  const value = useMemo<CallsConsole | null>(
    () =>
      agent
        ? {
            me: user,
            state,
            inUse: profilesRing || !!state.active || state.banners.length > 0,
            answerBlocked,
            soundBlocked,
            quality,
            playBlocked,
            setAvailable: (on) => cmd.current.setAvailable?.(on),
            dismiss: (callId) => cmd.current.dismiss?.(callId),
            answer: (callId) => cmd.current.answer?.(callId),
            hangUp: () => cmd.current.hangUp?.(),
            setMuted: (muted) => cmd.current.setMuted?.(muted),
            switchMic: (deviceId) => cmd.current.switchMic?.(deviceId),
            resumeAudio: () => cmd.current.resumeAudio?.(),
          }
        : null,
    [agent, user, state, profilesRing, answerBlocked, soundBlocked, quality, playBlocked],
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

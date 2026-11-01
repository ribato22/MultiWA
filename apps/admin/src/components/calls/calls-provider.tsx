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
import { initialState, reduce, type ConsoleState, type RingingCall } from '@/lib/call-console/console-state';
import { toast } from '@/hooks/use-toast';
import { useRingingAttention } from './use-ringing-attention';

type Ack = { ok: true; [key: string]: any } | { ok: false; reason: string; message?: string };
/** A `call:*` command and its ack; no ack within `ms` reads as the reason `timeout`. */
const command = (socket: Socket, event: string, args: object, ms: number): Promise<Ack> =>
  socket.timeout(ms).emitWithAck(event, args).catch(() => ({ ok: false as const, reason: 'timeout' }));

const ACK_MS = { availability: 5_000 };
/**
 * sessionStorage, per user: the availability the server last confirmed to this tab, whichever tab chose it. The server
 * forgets "unavailable" when the agent's last tab goes, a reload included; a new session starts available.
 */
const availableKey = (userId: string) => `multiwa:calls:${userId}:available`;
const FADE_MS = 4_000; // "Answered by …" and a call's end stay this long

export interface CallsConsole {
  me: CurrentUser;
  state: ConsoleState;
  /** A profile rings in the dashboard, or a call is here: the header shows the call controls. */
  inUse: boolean;
  /** Why this page cannot answer calls (no HTTPS, or a browser the media library cannot drive), else null. */
  answerBlocked: string | null;
  /** The ringtone needs a click on the page first (the browser's autoplay rule). */
  soundBlocked: boolean;
  setAvailable(on: boolean): void;
  dismiss(callId: string): void;
}

type Commands = Pick<CallsConsole, 'setAvailable' | 'dismiss'>;

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
    const availableAt = availableKey(user.id);
    const confirmed = (available: boolean) => {
      sessionStorage.setItem(availableAt, available ? 'on' : 'off');
      dispatch({ type: 'availability', available });
    };
    socket.on('connect', async () => {
      // The server forgot "unavailable" if this was the agent's last tab (a reload): the state it last confirmed here
      // stands. A failed read is tried once more: without one, the switch stays offline on a live socket.
      const off = sessionStorage.getItem(availableAt) === 'off';
      for (let tries = 0; tries < 2 && socket.connected; tries++) {
        const reply = await command(socket, 'call:availability', off ? { available: false } : {}, ACK_MS.availability);
        if (reply.ok) return confirmed(reply.available);
      }
    });
    socket.on('disconnect', async (reason) => {
      dispatch({ type: 'offline' });
      if (reason !== 'io server disconnect') return;
      // The server drops a socket whose token expired, or whose login is gone. A request's 401 refreshes an expired
      // token (or signs out), so the same token after one is a login that is gone.
      if (localStorage.getItem('accessToken') === sentToken) await api.me().catch(() => undefined);
      if (!closed && localStorage.getItem('accessToken') !== sentToken) socket.connect();
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

    cmd.current = { setAvailable, dismiss };
    return () => {
      cmd.current = {};
      closed = true;
      channel?.close();
      socket.disconnect();
    };
  }, [agent, user.id]);

  // "Answered by …", a failed answer and a call's end show for a moment, then go.
  useEffect(() => {
    const fading = state.banners.filter((b) => b.status === 'taken' || b.status === 'failed').map((b) => b.call.callId);
    if (state.active?.phase === 'ended') fading.push(state.active.call.callId);
    const timers = fading.map((callId) => setTimeout(() => dispatch({ type: 'drop', callId }), FADE_MS));
    return () => timers.forEach(clearTimeout);
  }, [state.banners, state.active]);

  const value = useMemo<CallsConsole | null>(
    () =>
      agent
        ? {
            me: user,
            state,
            inUse: profilesRing || !!state.active || state.banners.length > 0,
            answerBlocked,
            soundBlocked,
            setAvailable: (on) => cmd.current.setAvailable?.(on),
            dismiss: (callId) => cmd.current.dismiss?.(callId),
          }
        : null,
    [agent, user, state, profilesRing, answerBlocked, soundBlocked],
  );
  return (
    <CallsContext.Provider value={value}>
      {children}
      {agent && (
        <div id="calls-announcer" aria-live="assertive" aria-atomic="true" className="sr-only">
          <span key={announcement.id}>{announcement.text}</span>
        </div>
      )}
    </CallsContext.Provider>
  );
}

'use client';
// The call console, mounted once by the dashboard layout so a call lives on across pages: one socket per tab for the
// agent's events (the server sends them to the user's room, no `join`), the agent's commands, and the call's audio.
// The header's toggle, the banner and the in-call bar read it through useCalls().
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import { getSocketUrl } from '@/lib/socket';
import { canAnswerCalls, type CurrentUser } from '@/lib/current-user';
import { initialState, reduce, type ConsoleState } from '@/lib/call-console/console-state';

type Ack = { ok: true; [key: string]: any } | { ok: false; reason: string; message?: string };
/** A `call:*` command and its ack; no ack within `ms` reads as the reason `timeout`. */
const command = (socket: Socket, event: string, args: object, ms: number): Promise<Ack> =>
  socket.timeout(ms).emitWithAck(event, args).catch(() => ({ ok: false as const, reason: 'timeout' }));

const ACK_MS = { availability: 5_000 };
/** sessionStorage: the server forgets "unavailable" when the agent's last tab goes, a reload included. */
const AVAILABLE_KEY = 'multiwa:calls:available';

export interface CallsConsole {
  me: CurrentUser;
  state: ConsoleState;
  /** A profile rings in the dashboard, or a call is here: the header shows the call controls. */
  inUse: boolean;
  setAvailable(on: boolean): void;
}

type Commands = Pick<CallsConsole, 'setAvailable'>;

const CallsContext = createContext<CallsConsole | null>(null);
/** The console, or null for a login that takes no calls (a viewer). */
export const useCalls = () => useContext(CallsContext);

export function CallsProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const agent = canAnswerCalls(user.role);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [profilesRing, setProfilesRing] = useState(false);
  const cmd = useRef<Partial<Commands>>({});

  // Calls ring only for profiles that answer in the dashboard: without one, the header shows no call controls.
  useEffect(() => {
    if (!agent) return;
    void api.getProfiles().then(({ data }) => setProfilesRing(!!data?.some((p) => p.settings?.callsAnswerInDashboard === true)));
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    const socket = io(`${getSocketUrl()}/ws`, {
      transports: ['websocket', 'polling'],
      // Read at every (re)connect, so a refreshed token is the one sent.
      auth: (cb) => cb({ token: localStorage.getItem('accessToken') ?? undefined }),
    });
    let tokenAtConnect: string | null = null;

    // ── connection ──
    socket.on('connect', async () => {
      tokenAtConnect = localStorage.getItem('accessToken');
      // The server forgot "unavailable" if this was the agent's last tab (a reload): this tab's choice stands.
      const off = sessionStorage.getItem(AVAILABLE_KEY) === 'off';
      const reply = await command(socket, 'call:availability', off ? { available: false } : {}, ACK_MS.availability);
      if (reply.ok) dispatch({ type: 'availability', available: reply.available });
    });
    socket.on('disconnect', (reason) => {
      dispatch({ type: 'offline' });
      // The server drops a socket whose login is gone; after a token refresh in this tab, the new token may come back.
      if (reason === 'io server disconnect' && localStorage.getItem('accessToken') !== tokenAtConnect) socket.connect();
    });
    socket.on('call:availability', (p: { available: boolean }) => dispatch({ type: 'availability', available: p.available }));
    const setAvailable = async (on: boolean) => {
      sessionStorage.setItem(AVAILABLE_KEY, on ? 'on' : 'off');
      const reply = await command(socket, 'call:availability', { available: on }, ACK_MS.availability);
      if (reply.ok) dispatch({ type: 'availability', available: reply.available });
    };

    cmd.current = { setAvailable };
    return () => {
      cmd.current = {};
      socket.disconnect();
    };
  }, [agent, user.id]);

  const value = useMemo<CallsConsole | null>(
    () =>
      agent
        ? {
            me: user,
            state,
            inUse: profilesRing || !!state.active || state.banners.length > 0,
            setAvailable: (on) => cmd.current.setAvailable?.(on),
          }
        : null,
    [agent, user, state, profilesRing],
  );
  return <CallsContext.Provider value={value}>{children}</CallsContext.Provider>;
}

'use client';
// How a ringing call gets the agent's attention in this tab: the live region says each call that rings and what became
// of it, a desktop alert per call while the tab is in the background, and, while any call rings, the ringtone (unless
// this browser's ringer is off) and the title flash, but not while the agent answers or is on a call.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ringingCallerLabel } from '@/lib/calls';
import { desktopAlert, flashTitle, startRinging } from '@/lib/call-console/attention';
import type { ConsoleState, RingingCall } from '@/lib/call-console/console-state';
import { prefs } from '@/lib/call-console/prefs';

export function useRingingAttention(state: ConsoleState, userId: string) {
  const [soundBlocked, setSoundBlocked] = useState(false);
  // A new node per announcement: a screen reader says it again even when the words repeat (two calls from one caller).
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const ringingIds = state.banners.filter((b) => b.status === 'ringing').map((b) => b.call.callId).join(' ');
  const shown = useRef(new Map<string, { call: RingingCall; close: () => void }>());

  useEffect(() => {
    const { banners, active, dismissed } = stateRef.current;
    const ringing = banners.filter((b) => b.status === 'ringing').map((b) => b.call);
    const said: string[] = [];
    // A call that stopped ringing loses its alert, and the live region says what became of it, unless this tab is
    // answering it or dismissed it (a failed answer's banner speaks for itself).
    for (const [callId, { call, close }] of shown.current) {
      if (ringing.some((c) => c.callId === callId)) continue;
      close();
      shown.current.delete(callId);
      const b = banners.find((x) => x.call.callId === callId);
      const from = `Call from ${ringingCallerLabel(call.caller)}`;
      if (b?.status === 'taken') said.push(`${from} answered by ${b.by}`);
      else if (!b && active?.call.callId === callId) {
        if (!active.local) said.push(`${from} answered in another tab`);
      } else if (!b && !dismissed.includes(callId)) said.push(`${from} ended`);
    }
    for (const c of ringing) {
      if (shown.current.has(c.callId)) continue;
      shown.current.set(c.callId, { call: c, close: desktopAlert('Incoming call', `${ringingCallerLabel(c.caller)} on ${c.profileName}`, c.callId) });
      said.push(`Incoming call from ${ringingCallerLabel(c.caller)} on ${c.profileName}${c.isVideo ? '. Video call, answered by voice' : ''}${c.recorded ? '. This call is recorded' : ''}`);
    }
    if (said.length) setAnnouncement((p) => ({ id: p.id + 1, text: said.join('. ') }));
  }, [ringingIds]);
  useEffect(
    () => () => {
      shown.current.forEach(({ close }) => close());
      shown.current.clear();
    },
    [],
  );

  // The server rings an agent only if they are free when a call starts ringing: a call that rang before they answered
  // another keeps its banner, but goes quiet while they answer that one or are on a call (in this tab or another).
  const onCall = state.banners.some((b) => b.status === 'answering') || (!!state.active && state.active.phase !== 'ended');
  const ring = ringingIds !== '' && !onCall;
  useEffect(() => {
    if (ring) return flashTitle('📞 Incoming call');
  }, [ring]);
  // The ringer follows its switch at once, like a phone's silent switch: off, a ringing call goes quiet; on, it rings.
  const muted = useSyncExternalStore(prefs.watchRinger, () => prefs.ringerMuted(userId), () => false);
  useEffect(() => {
    if (!ring || muted) return;
    const stop = startRinging(setSoundBlocked);
    return () => {
      stop();
      setSoundBlocked(false);
    };
  }, [ring, muted]);

  return { soundBlocked, announcement };
}

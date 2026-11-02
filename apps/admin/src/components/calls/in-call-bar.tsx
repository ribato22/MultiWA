'use client';
// The call this agent is on, docked in the header on every page: who, how long, the recording, the network, and the
// controls. Another tab of the agent may hold the call's audio: the bar says so there.
import { useEffect, useId, useRef, useState } from 'react';
import { CircleDot, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Signal, SignalLow, SignalMedium, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CALL_AUDIO_TEXT, formatDuration, ringingCallerLabel } from '@/lib/calls';
import { consoleFocus, settleFocus, takeFocus } from '@/lib/call-console/focus';
import { useCalls } from './calls-provider';

const QUALITY = {
  good: { label: 'Good', Icon: Signal },
  fair: { label: 'Fair', Icon: SignalMedium },
  poor: { label: 'Poor', Icon: SignalLow },
} as const;

export function InCallBar() {
  const calls = useCalls();
  const a = calls?.state.active;
  const live = !!a && a.phase !== 'ended';
  const [now, setNow] = useState(() => Date.now());
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const barRef = useRef<HTMLDivElement>(null);
  const statusId = useId();
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  // The microphones, once this tab holds the call: their names need the permission the call already has. A microphone
  // plugged in or out changes the list.
  useEffect(() => {
    if (!live || !a?.local) return;
    const read = () => void navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)));
    read();
    navigator.mediaDevices.addEventListener('devicechange', read);
    return () => navigator.mediaDevices.removeEventListener('devicechange', read);
  }, [live, a?.local]);
  // Answer went with its banner, or Take the call here with its button: the focus lands on the call, not on the page.
  // Not on Hang up either, where a second Enter would give the call up while it connects.
  useEffect(() => {
    if (a?.local && document.activeElement === document.body) takeFocus(barRef.current);
  }, [a?.call.callId, a?.local]);
  // A control that had the focus went (the call ended, or Hear the caller played), or the bar did: the focus goes on
  // (lib/call-console/focus.ts).
  useEffect(settleFocus);
  if (!calls || !a) return null;

  const remaining = a.announcing ? Math.max(0, Math.ceil(a.announcing.durationSec - (now - a.announcing.since) / 1000)) : 0;
  // The socket is down: this tab's audio may still run, but nothing about the call reaches it until the socket is back.
  const reconnecting = a.local && !calls.socketUp;
  // A call stored here before a reload shows at once, but nothing says it goes on until the socket first connects:
  // Hang up waits for it.
  const unconfirmed = a.local && !calls.connectedOnce;
  // The live region changes with the phase only: the notice's countdown beside it is not said every second.
  const phase =
    a.phase === 'ended' ? a.endedText
    : a.phase === 'hanging_up' ? 'Hanging up…'
    : !a.local ? 'On a call in another tab'
    : reconnecting ? CALL_AUDIO_TEXT.reconnecting
    : a.phase === 'connecting' ? 'Connecting…'
    : a.phase === 'announcing' ? 'The caller hears the recording notice'
    : null;
  const q = calls.quality && a.local && a.phase === 'active' ? QUALITY[calls.quality] : null;
  return (
    <div
      ref={barRef}
      tabIndex={-1}
      data-call-console
      data-call-focus={live && a.local ? 'live' : undefined}
      {...consoleFocus}
      role="group"
      aria-label="Current call"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5"
    >
      <PhoneCall className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
      {/* Who, and how long: the controls go under it once less than 12rem is left for it. */}
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium text-foreground">
          {ringingCallerLabel(a.call.caller)} <span className="text-muted-foreground">· {a.call.profileName}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>
            <span role="status" id={statusId}>{phase}</span>
            {a.local && a.phase === 'announcing' && !reconnecting && <span aria-hidden="true" className="tabular-nums"> ({remaining} s)</span>}
          </span>
          {a.phase === 'active' && a.answeredAt && (
            <span role="timer" aria-label="Call time" className="tabular-nums">
              {formatDuration((now - Date.parse(a.answeredAt)) / 1000)}
            </span>
          )}
          {a.call.recorded && live && (
            <span className="inline-flex items-center gap-1 text-rose-300">
              <CircleDot className="h-3 w-3" aria-hidden="true" />
              Recording
            </span>
          )}
          {q && (
            <span className="inline-flex items-center gap-1" title="Network quality">
              <q.Icon className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Network quality: </span>
              {q.label}
            </span>
          )}
        </p>
        {a.problem && <p role="alert" className="text-xs text-amber-300">{a.problem}</p>}
      </div>
      {live && (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {a.local && calls.playBlocked && (
            <Button size="sm" variant="outline" onClick={calls.resumeAudio}>
              <Volume2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Hear the caller
            </Button>
          )}
          {a.local && (
            <Button
              size="sm"
              variant={a.muted ? 'secondary' : 'outline'}
              aria-pressed={a.muted}
              aria-disabled={a.phase === 'hanging_up'}
              onClick={() => a.phase !== 'hanging_up' && calls.setMuted(!a.muted)}
            >
              {a.muted ? <MicOff className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Mute
            </Button>
          )}
          {/* Once the call's audio is here: the microphone in use, or none while one that stopped is replaced. Any other
              one listed can be chosen, the one that stopped too once it is back. */}
          {a.local && calls.micId !== null && mics.length > 0 && (
            <Select value={calls.micId} onValueChange={calls.switchMic}>
              {/* A phone screen shows a microphone icon for the name, which a screen reader still hears. */}
              <SelectTrigger className="h-8 w-auto gap-1.5 px-2 text-xs sm:w-40 sm:px-3" aria-label="Microphone">
                <Mic className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  <SelectValue placeholder="No microphone" />
                </span>
              </SelectTrigger>
              <SelectContent data-call-console>
                {mics.map((m, i) => (
                  <SelectItem key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Only once the server put the call through: before, there is nothing to rejoin. */}
          {!a.local && (a.phase === 'announcing' || a.phase === 'active') && (
            <Button size="sm" variant="outline" onClick={calls.takeHere}>
              Take the call here
            </Button>
          )}
          {/* While it hangs up, the controls wait and keep the focus: the console takes one hang-up per call. */}
          <Button
            size="sm"
            variant="destructive"
            aria-disabled={a.phase === 'hanging_up' || unconfirmed}
            aria-describedby={unconfirmed ? statusId : undefined}
            onClick={() => !unconfirmed && calls.hangUp()}
          >
            {a.phase === 'hanging_up' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Hang up
          </Button>
        </div>
      )}
    </div>
  );
}

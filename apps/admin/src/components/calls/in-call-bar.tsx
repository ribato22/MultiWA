'use client';
// The call this agent is on, docked in the header on every page: who, how long, the recording, the network, and the
// controls. Another tab of the agent may hold the call's audio: the bar says so there.
import { useEffect, useRef, useState } from 'react';
import { CircleDot, Loader2, Mic, MicOff, PhoneCall, PhoneOff, Signal, SignalLow, SignalMedium, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDuration, ringingCallerLabel } from '@/lib/calls';
import { prefs } from '@/lib/call-console/prefs';
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
  const hangUpRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  // The microphones, once this tab holds the call: their names need the permission the call already has.
  useEffect(() => {
    if (!live || !a?.local) return;
    void navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId)));
  }, [live, a?.local]);
  // Answer was clicked away with its banner: the focus lands on Hang up, not on the page.
  useEffect(() => {
    if (a?.local && document.activeElement === document.body) hangUpRef.current?.focus();
  }, [a?.call.callId, a?.local]);
  if (!calls || !a) return null;

  const remaining = a.announcing ? Math.max(0, Math.ceil(a.announcing.durationSec - (now - a.announcing.since) / 1000)) : 0;
  const phase =
    a.phase === 'ended' ? a.endedText
    : a.phase === 'hanging_up' ? 'Hanging up…'
    : !a.local ? 'On a call in another tab'
    : a.phase === 'connecting' ? 'Connecting…'
    : a.phase === 'announcing' ? `The caller hears the recording notice (${remaining} s)`
    : null;
  const q = calls.quality && a.local && a.phase === 'active' ? QUALITY[calls.quality] : null;
  return (
    <div role="group" aria-label="Current call" className="flex min-w-0 items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5">
      <PhoneCall className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {ringingCallerLabel(a.call.caller)} <span className="text-muted-foreground">· {a.call.profileName}</span>
        </p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span role="status">{phase}</span>
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
              {q.label}
            </span>
          )}
        </p>
        {a.problem && <p role="alert" className="text-xs text-amber-300">{a.problem}</p>}
      </div>
      {live && (
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {a.local && calls.playBlocked && (
            <Button size="sm" variant="outline" onClick={calls.resumeAudio}>
              <Volume2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Hear the caller
            </Button>
          )}
          {a.local && (
            <Button size="sm" variant={a.muted ? 'secondary' : 'outline'} aria-pressed={a.muted} disabled={a.phase === 'hanging_up'} onClick={() => calls.setMuted(!a.muted)}>
              {a.muted ? <MicOff className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Mic className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Mute
            </Button>
          )}
          {a.local && mics.length > 1 && (
            <Select value={prefs.mic(calls.me.id) ?? mics[0].deviceId} onValueChange={calls.switchMic}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Microphone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mics.map((m, i) => (
                  <SelectItem key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* A darker red than the theme's: white small text on that one fails the contrast minimum. */}
          <Button ref={hangUpRef} size="sm" variant="destructive" className="bg-red-600 text-white hover:bg-red-700" disabled={a.phase === 'hanging_up'} onClick={calls.hangUp}>
            {a.phase === 'hanging_up' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Hang up
          </Button>
        </div>
      )}
    </div>
  );
}

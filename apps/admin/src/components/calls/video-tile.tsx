'use client';
// The video of a call answered with video, over every dashboard page (bottom right): the caller, and the agent's own
// camera in a corner while it is on. It shows while this tab holds the call's audio; the caller's voice plays in the
// console's own <audio>, so the pictures here are muted.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ringingCallerLabel } from '@/lib/calls';
import { useCalls } from './calls-provider';

/** A muted <video> of `stream`: srcObject is set on the element, React has no prop for it. */
function Picture({ stream, label, className }: { stream: MediaStream; label: string; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted aria-label={label} className={className} />;
}

export function VideoTile() {
  const calls = useCalls();
  const [hidden, setHidden] = useState(false);
  const a = calls?.state.active;
  const remote = calls?.video.remote ?? null;
  if (!calls || !a || !a.local || !a.video || a.phase === 'ended' || !remote) return null;
  const label = ringingCallerLabel(a.call.caller);
  const local = a.camera === 'on' ? calls.video.local : null;
  return (
    <section
      data-call-console
      aria-label="Video of the call"
      className="fixed bottom-4 right-4 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-primary/30 bg-card shadow-2xl shadow-black/40 sm:right-6"
    >
      <div className="flex items-center gap-2 py-1 pl-3 pr-1">
        <Video className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{label}</p>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>
          {hidden ? <ChevronUp className="mr-1 h-4 w-4" aria-hidden="true" /> : <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" />}
          {hidden ? 'Show video' : 'Hide video'}
        </Button>
      </div>
      {/* Hidden, the pictures go from the page: the call, its voice and its camera go on. */}
      {!hidden && (
        <div className="relative aspect-[4/3] bg-black">
          <Picture stream={remote} label={`Video of ${label}`} className="h-full w-full object-contain" />
          {/* The agent as the caller sees them, mirrored as a mirror shows a face. */}
          {local && (
            <Picture
              stream={local}
              label="Your camera"
              className="absolute bottom-2 right-2 aspect-[4/3] w-1/4 -scale-x-100 rounded-md border border-white/20 bg-black object-cover shadow-lg shadow-black/40"
            />
          )}
        </div>
      )}
    </section>
  );
}

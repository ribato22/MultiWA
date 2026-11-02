'use client';
// The incoming-call banner, over every dashboard page (top right, above dialogs): one card per call ringing this agent.
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { CircleDot, Loader2, MessagesSquare, Phone, PhoneIncoming, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { READINESS_TEXT, ringingCallerLabel } from '@/lib/calls';
import { consoleFocus, settleFocus } from '@/lib/call-console/focus';
import { useCalls } from './calls-provider';

export function IncomingCallBanner() {
  const calls = useCalls();
  const answerRef = useRef<HTMLButtonElement>(null);
  const banners = calls?.state.banners ?? [];
  const a = calls?.state.active;
  const ringingIds = banners.filter((b) => b.status === 'ringing').map((b) => b.call.callId);
  const newest = ringingIds.at(-1);
  const ringing = ringingIds.join(' ');
  const rang = useRef('');
  // While this tab answers a call or is on one, the focus stays with that call: no ring takes it.
  const busy = banners.some((b) => b.status === 'answering') || (!!a?.local && a.phase !== 'ended');
  // A call that starts ringing takes the focus to its Answer, unless the agent is typing: an Enter meant for a field
  // must not answer. An older call left newest by one that stopped ringing takes nothing: the focus may be anywhere.
  useEffect(() => {
    const before = rang.current.split(' ');
    rang.current = ringing;
    if (!newest || before.includes(newest) || busy) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
    answerRef.current?.focus();
  }, [ringing]);
  // A card that had the focus went, or lost the button that had it: the focus goes on (lib/call-console/focus.ts).
  useEffect(settleFocus);
  if (!calls || !banners.length) return null;
  return (
    <section data-call-console {...consoleFocus} aria-label="Incoming calls" className="pointer-events-auto fixed right-4 top-20 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6">
      {banners.map((b) => {
        const label = ringingCallerLabel(b.call.caller);
        const unavailable = !b.call.answerable
          ? READINESS_TEXT[b.call.unavailableReason ?? ''] ?? 'This call cannot be answered here'
          : calls.answerBlocked;
        return (
          // Each card can hold the focus, as a failed answer's does to say why: one that rings again keeps it meanwhile.
          <div
            key={b.call.callId}
            tabIndex={-1}
            data-call-focus={b.status === 'failed' ? 'failed' : undefined}
            role="group"
            aria-label={`Call from ${label}`}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && b.status === 'ringing') calls.dismiss(b.call.callId);
            }}
            className={`rounded-xl border border-primary/40 bg-card p-4 shadow-2xl shadow-black/40 transition-opacity ${b.status === 'taken' || b.status === 'failed' ? 'opacity-70' : ''}`}
          >
            <div className="flex items-start gap-3">
              <PhoneIncoming className={`mt-0.5 h-5 w-5 flex-shrink-0 text-primary ${b.status === 'ringing' ? 'animate-pulse' : ''}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Incoming call · {b.call.profileName}</p>
                <p className="truncate font-semibold text-foreground">{label}</p>
                {label === b.call.caller.name && b.call.caller.number && <p className="text-xs tabular-nums text-muted-foreground">+{b.call.caller.number}</p>}
                {b.call.recorded && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-rose-300">
                    <CircleDot className="h-3 w-3" aria-hidden="true" />
                    This call is recorded
                  </p>
                )}
              </div>
              {b.call.conversationId && (
                <Link
                  href={`/dashboard/chat?profile=${b.call.profileId}&conv=${b.call.conversationId}`}
                  aria-label={`Open the chat with ${label}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <MessagesSquare className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>
            {b.status === 'taken' ? (
              <p className="mt-3 text-sm text-muted-foreground">Answered by {b.by}</p>
            ) : b.status === 'failed' ? (
              <p role="alert" className="mt-3 text-sm text-amber-300">{b.message}</p>
            ) : (
              <>
                {unavailable && (
                  <div className="mt-3 text-amber-300">
                    <p className="text-sm font-medium">Answer on the phone</p>
                    <p className="text-xs">{unavailable}</p>
                  </div>
                )}
                {b.status === 'ringing' && b.notice && <p role="alert" className="mt-2 text-xs text-amber-300">{b.notice}</p>}
                {/* Always there, only hidden: a line that came and went would move the buttons under a press. */}
                <p className={`mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground ${calls.soundBlocked && b.status === 'ringing' ? '' : 'invisible'}`}>
                  <VolumeX className="h-3 w-3" aria-hidden="true" />
                  Click anywhere on the page to hear the ringtone
                </p>
                <div className="mt-3 flex gap-2">
                  {/* While it connects, Answer and Dismiss wait, and Answer keeps the focus: the console takes one answer
                      per call. */}
                  <Button
                    ref={b.call.callId === newest ? answerRef : undefined}
                    data-call-focus={b.status}
                    size="sm"
                    className="flex-1"
                    disabled={!!unavailable}
                    aria-disabled={b.status === 'answering'}
                    onClick={() => calls.answer(b.call.callId)}
                  >
                    {b.status === 'answering' ? <Loader2 className="mr-1.5 h-4 w-4 mw-spin" aria-hidden="true" /> : <Phone className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                    {b.status === 'answering' ? 'Connecting…' : 'Answer'}
                  </Button>
                  <Button size="sm" variant="outline" aria-disabled={b.status === 'answering'} onClick={() => b.status === 'ringing' && calls.dismiss(b.call.callId)}>
                    <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Dismiss
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

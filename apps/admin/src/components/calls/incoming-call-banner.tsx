'use client';
// The incoming-call banner, over every dashboard page (top right, above dialogs): one card per call ringing this agent.
import Link from 'next/link';
import { CircleDot, MessagesSquare, PhoneIncoming, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { READINESS_TEXT, ringingCallerLabel } from '@/lib/calls';
import { useCalls } from './calls-provider';

export function IncomingCallBanner() {
  const calls = useCalls();
  const banners = calls?.state.banners ?? [];
  if (!calls || !banners.length) return null;
  return (
    <section aria-label="Incoming calls" className="pointer-events-auto fixed right-4 top-20 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 sm:right-6">
      {banners.map((b) => {
        const label = ringingCallerLabel(b.call.caller);
        const unavailable = !b.call.answerable
          ? READINESS_TEXT[b.call.unavailableReason ?? ''] ?? 'This call cannot be answered here'
          : calls.answerBlocked;
        return (
          <div
            key={b.call.callId}
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
                  <Button size="sm" variant="outline" disabled={b.status === 'answering'} onClick={() => calls.dismiss(b.call.callId)}>
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

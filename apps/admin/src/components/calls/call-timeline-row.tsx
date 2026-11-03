// A call in the chat timeline ("Voice call · Missed · 10.32").
import type { CallRecord } from '@/lib/api';
import { OUTCOME_LABEL, knownOutcome } from '@/lib/calls';
import { formatFull, formatTime } from '@/lib/datetime';
import { outcomeIcon } from '@/components/calls/outcome-icon';

export function CallTimelineRow({ call }: { call: CallRecord }) {
  const outcome = knownOutcome(call.outcome);
  const Icon = outcomeIcon(outcome);
  return (
    <div className="flex justify-center my-2">
      <span
        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-secondary/60 ${outcome === 'missed' ? 'text-red-400' : 'text-muted-foreground'}`}
        title={formatFull(call.startedAt)}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {call.isVideo ? 'Video call' : 'Voice call'} · {OUTCOME_LABEL[outcome]} · {formatTime(call.startedAt)}
      </span>
    </div>
  );
}

// A call in the chat timeline ("Voice call · Missed · 10.32").
import { Phone, PhoneMissed, PhoneOff } from 'lucide-react';
import type { CallRecord } from '@/lib/api';
import { OUTCOME_LABEL } from '@/lib/calls';
import { formatFull, formatTime } from '@/lib/datetime';

export function CallTimelineRow({ call }: { call: CallRecord }) {
  const Icon = call.outcome === 'rejected' ? PhoneOff : call.outcome === 'answered_elsewhere' ? Phone : PhoneMissed;
  return (
    <div className="flex justify-center my-2">
      <span
        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-secondary/60 ${call.outcome === 'missed' ? 'text-red-400' : 'text-muted-foreground'}`}
        title={formatFull(call.startedAt)}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {call.isVideo ? 'Video call' : 'Voice call'} · {OUTCOME_LABEL[call.outcome]} · {formatTime(call.startedAt)}
      </span>
    </div>
  );
}

'use client';

import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { PlayCircle, Inbox, TypeIcon, Regex, UserPlus, type LucideIcon } from 'lucide-react';

interface TriggerNodeData {
  label: string;
  triggerType: string;
  filters?: Record<string, unknown>;
}

type TriggerInfo = { Icon: LucideIcon; label: string };

const triggerInfo: Record<string, TriggerInfo> = {
  all:                { Icon: Inbox,    label: 'All Messages' },
  keyword:            { Icon: TypeIcon, label: 'Keyword Match' },
  regex:              { Icon: Regex,    label: 'Pattern Match' },
  new_contact:        { Icon: UserPlus, label: 'New Contact' },
  // Legacy values for backward compatibility
  'message.received': { Icon: Inbox,    label: 'Message Received' },
  'message.keyword':  { Icon: TypeIcon, label: 'Keyword Match' },
  'contact.created':  { Icon: UserPlus, label: 'New Contact' },
  all_messages:       { Icon: Inbox,    label: 'All Messages' },
};

export const TriggerNode = memo(({ data, selected }: NodeProps<TriggerNodeData>) => {
  const info = triggerInfo[data.triggerType] ?? { Icon: PlayCircle, label: data.label };
  const LabelIcon = info.Icon;

  return (
    <div
      className={`
        px-5 py-4 rounded-2xl min-w-[180px]
        bg-primary/10 border-2
        transition-all duration-200
        ${selected
          ? 'border-primary shadow-lg shadow-primary/30'
          : 'border-primary/40 shadow-md shadow-black/20'}
      `}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary">
          <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider text-primary">
          Trigger
        </span>
      </div>
      <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <LabelIcon className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden="true" />
        <span className="truncate">{info.label}</span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#22c55e',
          width: '12px',
          height: '12px',
          border: '2px solid hsl(217 33% 17%)',
          boxShadow: '0 2px 6px rgba(34, 197, 94, 0.4)',
        }}
      />
    </div>
  );
});

TriggerNode.displayName = 'TriggerNode';
